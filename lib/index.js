/**
 * dsh-openai-api — OpenAI-compatible HTTP surface for dsh,
 * backed by real DSH agent sessions.
 *
 * Host plugin. Registers routes on the `webServer` service:
 *
 *   GET  <prefix>/models             advertised model id
 *   POST <prefix>/chat/completions   Chat Completions, stream + non-stream
 *   POST <prefix>/responses          Responses API subset, stream + non-stream
 *
 * Generation is served by a live DSH agent session (the harness `agents`
 * registry + the agent loop), so every request gets the agent's full world:
 * its configured tools, skills, prompt sections, and preset persona. This is
 * the "agent gateway" architecture — the direct opposite of a thin LLM
 * proxy, and it is what makes tool use, multi-step reasoning, and preset
 * personalities available over an OpenAI-shaped wire.
 *
 * Session identity is (API key tenant, `X-Agent-Preset`):
 *   - the accepted API key namespaces the caller — one session per key, so
 *     different keys never share a session even for the same preset;
 *   - the `X-Agent-Preset` header names the preset the session joins
 *     (absent → the profile default). Resolved only at session creation.
 * The first request for a (key, preset) pair seeds the session by rendering
 * the client's full message array into a labeled transcript prompt; later
 * requests admit only the latest user turn (the session already holds the
 * history). Committed assistant text leaves the wire; reasoning, tool calls,
 * and token-level chunk streams stay off it. Streaming deltas arrive once per
 * committed assistant message, not per token.
 *
 * Zero package dependencies: services are reached through ctx.get()/inject,
 * messages are built as plain frozen objects matching the harness Message
 * vocabulary, and only node builtins are imported.
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import { mountUiSnapshot, mountUiStatus } from "./ui-status.js";
// Windows 本地补丁（2026-08-31）：cwd 校验支持 Windows 盘符绝对路径
// （D:/temp、D:\temp）。原实现只认 "/" 开头（POSIX），Windows 下
// 只能写成 /D:/temp 会被 Node 解析成错误的 D:\D:\temp。
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";

//#region plugin metadata
/** Stable Cordis plugin name. */
const name = "openai-api";
/**
 * Both are hard dependencies: agent sessions come from `agents`, and the
 * routes need `webServer`. Declaring them as inject keeps this fiber after
 * both services are available (a plain ctx.get during apply can race a fresh
 * boot and see undefined).
 */
const inject = ["agents", "webServer"];
//#endregion

//#region configuration (dependency-free validation, schema-style defaults)
const DEFAULTS = Object.freeze({
	/** Model id advertised at /v1/models and used by sessions whose first request names no model. */
	model: "default",
	/** Provider route for created sessions (AgentOptions.provider). */
	provider: undefined,
	/** Per-client keys: each distinct key is a separate tenant. Empty means one keyless tenant. */
	apiKeys: [],
	/** Absolute working directory for created sessions. */
	cwd: undefined,
	/** Route prefix. */
	pathPrefix: "/v1",
	/** Maximum accepted JSON body size in bytes. */
	maxBodyBytes: 32 * 1024 * 1024,
	/** Extra browser origins allowed to call cross-origin (exact origin strings). */
	allowedOrigins: [],
});

function resolveConfig(raw) {
	if (raw !== undefined && raw !== null && (typeof raw !== "object" || Array.isArray(raw))) {
		throw new Error("openai-api config must be an object");
	}
	const record = raw ?? {};
	const out = {
		model: DEFAULTS.model,
		provider: DEFAULTS.provider,
		apiKeys: DEFAULTS.apiKeys,
		cwd: DEFAULTS.cwd,
		pathPrefix: DEFAULTS.pathPrefix,
		maxBodyBytes: DEFAULTS.maxBodyBytes,
		allowedOrigins: DEFAULTS.allowedOrigins,
	};
	const known = new Set(Object.keys(DEFAULTS));
	for (const key of Object.keys(record)) {
		if (!known.has(key)) throw new Error(`openai-api config: unknown key ${JSON.stringify(key)}`);
	}
	if (record.model !== undefined) {
		if (typeof record.model !== "string" || record.model.trim() === "") throw new Error("openai-api config.model must be a non-empty string");
		out.model = record.model;
	}
	if (record.provider !== undefined) {
		if (typeof record.provider !== "string" || record.provider.trim() === "") throw new Error("openai-api config.provider must be a non-empty string");
		out.provider = record.provider;
	}
	if (record.apiKeys !== undefined) {
		if (!Array.isArray(record.apiKeys) || record.apiKeys.length === 0 || record.apiKeys.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
			throw new Error("openai-api config.apiKeys must be a non-empty array of non-empty strings");
		}
		out.apiKeys = record.apiKeys.map(String);
	}
	if (record.cwd !== undefined) {
		if (typeof record.cwd !== "string" || record.cwd.trim() === "" || !isAbsolute(record.cwd)) throw new Error("openai-api config.cwd must be an absolute path");
		out.cwd = record.cwd;
	}
	if (record.pathPrefix !== undefined) {
		if (typeof record.pathPrefix !== "string" || record.pathPrefix.trim() === "") throw new Error("openai-api config.pathPrefix must be a non-empty string");
		out.pathPrefix = record.pathPrefix;
	}
	if (record.maxBodyBytes !== undefined) {
		if (!Number.isSafeInteger(record.maxBodyBytes) || record.maxBodyBytes < 1024) throw new Error("openai-api config.maxBodyBytes must be an integer >= 1024");
		out.maxBodyBytes = record.maxBodyBytes;
	}
	if (record.allowedOrigins !== undefined) {
		if (!Array.isArray(record.allowedOrigins) || record.allowedOrigins.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
			throw new Error("openai-api config.allowedOrigins must be an array of origin strings");
		}
		out.allowedOrigins = record.allowedOrigins.map(String);
	}
	let prefix = out.pathPrefix;
	if (!prefix.startsWith("/")) prefix = `/${prefix}`;
	out.pathPrefix = prefix.replace(/\/+$/, "");
	return out;
}
//#endregion

//#region shared HTTP plumbing
class HttpError extends Error {
	constructor(status, type, code, message) {
		super(message);
		this.status = status;
		this.type = type;
		this.code = code;
	}
}

function isLoopbackAddress(address) {
	if (typeof address !== "string") return false;
	if (address === "::1") return true;
	if (address.startsWith("::ffff:")) address = address.slice(7);
	return address === "127.0.0.1" || address.startsWith("127.");
}

function constantTimeEquals(left, right) {
	const a = Buffer.from(String(left));
	const b = Buffer.from(String(right));
	if (a.length !== b.length) {
		timingSafeEqual(b, b);
		return false;
	}
	return timingSafeEqual(a, b);
}

function securityHeaders() {
	return { "x-content-type-options": "nosniff", "cache-control": "no-store" };
}

function corsDecision(req, config) {
	const origin = req.headers.origin;
	const host = req.headers.host ?? "";
	if (typeof origin !== "string" || origin.length === 0) return { allowed: true, echo: undefined };
	try {
		if (new URL(origin).host === host) return { allowed: true, echo: origin };
	} catch {
		return { allowed: false, echo: undefined };
	}
	if (config.allowedOrigins.includes(origin)) return { allowed: true, echo: origin };
	return { allowed: false, echo: undefined };
}

function applyCorsHeaders(res, decision) {
	res.setHeader("vary", "Origin");
	if (decision.echo !== undefined) {
		res.setHeader("access-control-allow-origin", decision.echo);
		res.setHeader("access-control-expose-headers", "x-request-id");
	}
}

function wireError(status, type, message) {
	return { status, type, message };
}

function errorBody(error) {
	return { error: { message: error.message, type: error.type || "invalid_request_error", param: null, code: error.code ?? null } };
}

function sendJson(res, status, body) {
	if (responseEnded(res)) return;
	if (res.headersSent) {
		res.end();
		return;
	}
	res.writeHead(status, { ...securityHeaders(), "content-type": "application/json" });
	res.end(JSON.stringify(body));
}

function sendOpenAiError(res, status, type, code, message) {
	if (res.writableEnded || res.destroyed) return;
	if (res.headersSent) {
		res.end();
		return;
	}
	sendJson(res, status, errorBody(wireError(status, type, message)));
}

function responseEnded(res) {
	return res.writableEnded || res.destroyed;
}

function authorizeOptions(req, res, config) {
	// CORS origin fence + preflight. Returns true when allowed to proceed.
	const decision = corsDecision(req, config);
	if (!decision.allowed) {
		sendOpenAiError(res, 403, "invalid_request_error", "origin_not_allowed", "openai-api: this origin may not call the OpenAI-compatible surface.");
		return false;
	}
	applyCorsHeaders(res, decision);
	if (req.method === "OPTIONS") {
		res.statusCode = 204;
		res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
		res.setHeader("access-control-allow-headers", "authorization, content-type, x-agent-preset, x-session-id");
		res.setHeader("access-control-max-age", "600");
		res.end();
		return false;
	}
	return true;
}

async function readJsonBody(req, res, maxBodyBytes) {
	const declared = Number(req.headers["content-length"]);
	if (Number.isFinite(declared) && declared > maxBodyBytes) {
		sendOpenAiError(res, 413, "invalid_request_error", "body_too_large", `openai-api: body exceeds maxBodyBytes (${maxBodyBytes}).`);
		return undefined;
	}
	const chunks = [];
	let total = 0;
	let aborted = false;
	req.on("aborted", () => {
		aborted = true;
	});
	try {
		for await (const chunk of req) {
			total += chunk.length;
			if (total > maxBodyBytes) {
				sendOpenAiError(res, 413, "invalid_request_error", "body_too_large", `openai-api: body exceeds maxBodyBytes (${maxBodyBytes}).`);
				return undefined;
			}
			chunks.push(chunk);
			if (aborted) return undefined;
		}
	} catch {
		return undefined;
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (text.trim().length === 0) {
		sendOpenAiError(res, 400, "invalid_request_error", "empty_body", "openai-api: expected a JSON body.");
		return undefined;
	}
	try {
		const parsed = JSON.parse(text);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
			sendOpenAiError(res, 400, "invalid_request_error", "invalid_json", "openai-api: body must be a JSON object.");
			return undefined;
		}
		return parsed;
	} catch {
		sendOpenAiError(res, 400, "invalid_request_error", "invalid_json", "openai-api: body is not valid JSON.");
		return undefined;
	}
}
//#endregion

//#region wire validation + framing (mirrors the reference implementation)
/** Request keys that change agent behavior in ways this endpoint cannot honor. */
const REJECTED_KEYS = {
	tools: "function calling (tools) is not supported by this endpoint",
	tool_choice: "function calling (tool_choice) is not supported by this endpoint",
	functions: "function calling (functions) is not supported by this endpoint",
	function_call: "function calling (function_call) is not supported by this endpoint",
};

function contentText(content, index) {
	if (typeof content === "string") return { text: content };
	if (content === undefined || content === null) return { error: wireError(400, "invalid_request_error", `messages[${index}].content is required`) };
	if (!Array.isArray(content)) return { error: wireError(400, "invalid_request_error", `messages[${index}].content must be a string or an array of text parts`) };
	let out = "";
	for (let i = 0; i < content.length; i++) {
		const part = content[i];
		if (part !== null && typeof part === "object" && part.type === "text" && typeof part.text === "string") {
			out += part.text;
			continue;
		}
		return { error: wireError(400, "invalid_request_error", `messages[${index}].content[${i}] must be a text part (image and other parts are not supported)`) };
	}
	return { text: out };
}

/**
 * Validate one chat-completions body.
 * @param body - parsed JSON request body.
 * @param isFirstRequest - true when the session does not exist yet: the full
 *   message array is rendered into a transcript prompt. False: only the
 *   latest user turn is admitted (the session already holds the history).
 */
function parseChatRequest(body, isFirstRequest) {
	if (body === null || typeof body !== "object" || Array.isArray(body)) return { error: wireError(400, "invalid_request_error", "request body must be a JSON object") };
	const record = body;
	for (const [key, why] of Object.entries(REJECTED_KEYS)) {
		if (key in record) return { error: wireError(400, "invalid_request_error", why) };
	}
	if ("n" in record && record.n !== undefined && record.n !== 1) return { error: wireError(400, "invalid_request_error", "only n=1 is supported") };
	if ("stream" in record && record.stream !== undefined && typeof record.stream !== "boolean") return { error: wireError(400, "invalid_request_error", "stream must be a boolean") };
	if ("model" in record && record.model !== undefined && (typeof record.model !== "string" || record.model === "")) return { error: wireError(400, "invalid_request_error", "model must be a non-empty string") };
	const maxTokensRaw = record.max_tokens !== undefined ? record.max_tokens : record.max_completion_tokens;
	if (maxTokensRaw !== undefined && (typeof maxTokensRaw !== "number" || !Number.isInteger(maxTokensRaw) || maxTokensRaw <= 0)) return { error: wireError(400, "invalid_request_error", "max_tokens must be a positive integer") };
	let includeUsage = false;
	if ("stream_options" in record && record.stream_options !== undefined) {
		const options = record.stream_options;
		if (options === null || typeof options !== "object" || Array.isArray(options) || Object.keys(options).length === 0) return { error: wireError(400, "invalid_request_error", "stream_options must be a non-empty object (only include_usage is supported)") };
		for (const key of Object.keys(options)) {
			if (key !== "include_usage") return { error: wireError(400, "invalid_request_error", `stream_options.${key} is not supported (only include_usage)`) };
		}
		if (typeof options.include_usage !== "boolean") return { error: wireError(400, "invalid_request_error", "stream_options.include_usage must be a boolean") };
		includeUsage = options.include_usage;
	}
	const messagesRaw = record.messages;
	if (!Array.isArray(messagesRaw) || messagesRaw.length === 0) return { error: wireError(400, "invalid_request_error", "messages must be a non-empty array") };
	const messages = [];
	for (let i = 0; i < messagesRaw.length; i++) {
		const entry = messagesRaw[i];
		if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return { error: wireError(400, "invalid_request_error", `messages[${i}] must be an object`) };
		let role;
		if (entry.role === "user" || entry.role === "system" || entry.role === "assistant") role = entry.role;
		else if (entry.role === "developer") role = "system";
		else if (entry.role === "tool") return { error: wireError(400, "invalid_request_error", "tool-role messages are not supported (no function calling)") };
		else return { error: wireError(400, "invalid_request_error", `messages[${i}].role must be user, assistant, system, or developer`) };
		const content = contentText(entry.content, i);
		if (content.error !== undefined) return { error: content.error };
		messages.push({ role, text: content.text });
	}
	let promptText;
	if (isFirstRequest) {
		promptText = renderTranscript(messages);
	} else {
		for (let i = messages.length - 1; i >= 0; i--) {
			const message = messages[i];
			if (message.role === "user" && message.text !== "") {
				promptText = message.text;
				break;
			}
		}
	}
	if (promptText === undefined) return { error: wireError(400, "invalid_request_error", "no user message to admit: the session already holds this conversation, send a new user turn") };
	return {
		value: {
			messages,
			stream: record.stream === true,
			model: typeof record.model === "string" && record.model !== "" ? record.model : undefined,
			maxTokens: typeof maxTokensRaw === "number" ? maxTokensRaw : undefined,
			includeUsage,
			promptText,
		},
	};
}

/** Render the client's full message array as one labeled transcript for the first request. */
function renderTranscript(messages) {
	const lines = [
		"An OpenAI-compatible client provided this conversation history on the first request of this session.",
		"The entries below are earlier turns of this conversation, in order. Continue the conversation from the final entry.",
		"",
	];
	for (const message of messages) {
		lines.push(`[${message.role}] ${message.text}`);
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}

/** Map a turn end reason to the OpenAI finish_reason (error endings are 5xx, never a finish). */
function finishReason(reason) {
	const kind = reason !== undefined ? reason.kind : undefined;
	if (kind === "max-tokens" || kind === "length") return "length";
	return "stop";
}

/** Accumulate one committed message's usage into a running total (disjoint fields sum exactly). */
function addUsage(total, usage) {
	if (usage === undefined) return total;
	if (total === undefined) return { ...usage };
	const next = { inputTokens: total.inputTokens + usage.inputTokens, outputTokens: total.outputTokens + usage.outputTokens };
	if (total.cacheReadTokens !== undefined || usage.cacheReadTokens !== undefined) next.cacheReadTokens = (total.cacheReadTokens ?? 0) + (usage.cacheReadTokens ?? 0);
	if (total.cacheWriteTokens !== undefined || usage.cacheWriteTokens !== undefined) next.cacheWriteTokens = (total.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
	if (total.reasoningTokens !== undefined || usage.reasoningTokens !== undefined) next.reasoningTokens = (total.reasoningTokens ?? 0) + (usage.reasoningTokens ?? 0);
	return next;
}

/** The OpenAI usage object from a DSH TokenUsage (disjoint counts -> billed totals). */
function usageBody(usage) {
	if (usage === undefined) return undefined;
	const prompt = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
	const completion = usage.outputTokens + (usage.reasoningTokens ?? 0);
	return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
}

const newCompletionId = () => `chatcmpl-${randomUUID().replace(/-/g, "")}`;
const newResponseId = () => `resp_${randomUUID().replace(/-/g, "")}`;

function completionBody({ id, created, model, outcome }) {
	const body = {
		id,
		object: "chat.completion",
		created,
		model,
		choices: [{ index: 0, message: { role: "assistant", content: outcome.text }, finish_reason: outcome.finish, logprobs: null }],
	};
	const usage = usageBody(outcome.usage);
	if (usage !== undefined) body.usage = usage;
	return body;
}

function chunkBody({ id, created, model, delta, finish }) {
	return {
		id,
		object: "chat.completion.chunk",
		created,
		model,
		choices: [{ index: 0, delta, finish_reason: finish ?? null }],
	};
}

function sseFrame(payload) {
	return `data: ${JSON.stringify(payload)}\n\n`;
}

const SSE_DONE = "data: [DONE]\n\n";

function modelsBody(model) {
	return { object: "list", data: [{ id: model, object: "model", created: 0, owned_by: "deepseek-harness" }] };
}
//#endregion

//#region Responses API helpers (agent-backed, one message per turn)
function responsesInputToChat(input) {
	if (typeof input === "string") {
		return input.trim().length === 0 ? { error: wireError(400, "invalid_request_error", "'input' must not be empty") } : { messages: [{ role: "user", content: input }] };
	}
	if (input === null || input === undefined) return { error: wireError(400, "invalid_request_error", "'input' is required") };
	if (!Array.isArray(input)) return { error: wireError(400, "invalid_request_error", "'input' must be a string or an array of items") };
	const messages = [];
	for (const item of input) {
		if (typeof item === "string") {
			messages.push({ role: "user", content: item });
			continue;
		}
		if (item === null || typeof item !== "object" || Array.isArray(item)) return { error: wireError(400, "invalid_request_error", "input items must be objects or strings") };
		const kind = item.type;
		if (kind === "message" || (kind === undefined && typeof item.role === "string")) {
			const text = respContentText(item.content);
			if (text.error !== undefined) return { error: text.error };
			const role = item.role === "developer" ? "system" : item.role;
			if (role === "system" || role === "user" || role === "assistant") messages.push({ role, content: text.text });
			else return { error: wireError(400, "invalid_request_error", `input.role '${String(item.role)}' is not supported`) };
			continue;
		}
		if (kind === "reasoning") {
			continue; // chain-of-thought replay carries no prompt text
		}
		if (kind === "function_call" || kind === "function_call_output") {
			return { error: wireError(400, "invalid_request_error", `function calling (${kind}) is not supported by this agent-backed endpoint`) };
		}
		if (kind === undefined || kind === null) return { error: wireError(400, "invalid_request_error", "input item has no recognizable type") };
		return { error: wireError(400, "invalid_request_error", `input item type '${String(kind)}' is not supported by this agent-backed endpoint`) };
	}
	if (messages.length === 0) return { error: wireError(400, "invalid_request_error", "'input' must contain at least one message") };
	return { messages };
}

function respContentText(content) {
	if (typeof content === "string") return { text: content };
	if (content === undefined || content === null) return { text: "" };
	if (!Array.isArray(content)) return { error: wireError(400, "invalid_request_error", "content must be a string or an array of parts") };
	let out = "";
	for (const part of content) {
		if (part !== null && typeof part === "object" && typeof part.text === "string") {
			out += part.text;
			continue;
		}
		return { error: wireError(400, "invalid_request_error", "content parts must carry a text string (images are not supported)") };
	}
	return { text: out };
}

/** Normalize a Responses request into the chat validation used above. */
function orchestrateResponses(body, isFirst) {
	if (body === null || typeof body !== "object" || Array.isArray(body)) return { error: wireError(400, "invalid_request_error", "request body must be a JSON object") };
	const conv = responsesInputToChat(body.input);
	if ("error" in conv) return { error: conv.error };
	// Reuse the chat validator with the Responses-appropriate field mapping.
	// stream/model/max_output_tokens/stream_options are honored; tools are
	// rejected (the agent owns tool use). previous_response_id is accepted and
	// ignored: the sticky (tenant, preset) session is the store.
	const parsed = parseChatRequest(
		{
			messages: conv.messages,
			...(body.stream !== undefined ? { stream: body.stream } : {}),
			...(body.model !== undefined ? { model: body.model } : {}),
			...(body.max_output_tokens !== undefined ? { max_completion_tokens: body.max_output_tokens } : {}),
			...(body.stream_options !== undefined ? { stream_options: body.stream_options } : {}),
		},
		isFirst,
	);
	if ("error" in parsed) return { error: parsed.error };
	return {
		value: {
			...parsed.value,
			instructions: typeof body.instructions === "string" ? body.instructions : undefined,
			previousResponseId: body.previous_response_id ?? null,
		},
	};
}

function responseBody(responseId, created, model, outcome, instructions) {
	const usage = usageBody(outcome.usage);
	return {
		id: responseId,
		object: "response",
		created_at: created,
		status: "completed",
		error: null,
		incomplete_details: null,
		instructions: instructions ?? null,
		metadata: {},
		model,
		output: [
			{
				id: `msg_${randomUUID().replace(/-/g, "")}`,
				type: "message",
				status: "completed",
				role: "assistant",
				content: [{ type: "output_text", text: outcome.text, annotations: [] }],
			},
		],
		parallel_tool_calls: true,
		previous_response_id: null,
		reasoning: { effort: null, summary: null },
		store: false,
		temperature: null,
		text: { format: { type: "text" } },
		tool_choice: "auto",
		tools: [],
		top_p: null,
		truncation: "disabled",
		usage: usage === undefined
			? { input_tokens: 0, output_tokens: 0, total_tokens: 0, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } }
			: {
				input_tokens: usage.prompt_tokens,
				output_tokens: usage.completion_tokens,
				total_tokens: usage.total_tokens,
				input_tokens_details: { cached_tokens: 0 },
				output_tokens_details: { reasoning_tokens: 0 },
			},
		user: null,
	};
}

function emitResponsesStream(res, inflight, outcome, instructions) {
	let sequence = 0;
	const response = responseBody(inflight.completionId, inflight.created, inflight.model, outcome, instructions);
	const emit = (event, payload) => {
		if (res.writableEnded) return;
		const frame = { type: event, sequence_number: ++sequence, ...(payload === undefined ? {} : payload) };
		res.write(`event: ${event}\n`);
		res.write(`data: ${JSON.stringify(frame)}\n\n`);
	};
	emit("response.created", { response: { ...response, output: [] } });
	emit("response.in_progress", { response: { ...response, output: [] } });
	const itemId = `msg_${randomUUID().replace(/-/g, "")}`;
	const item = { id: itemId, type: "message", status: "in_progress", role: "assistant", content: [{ type: "output_text", text: "", annotations: [] }] };
	emit("response.output_item.added", { output_index: 0, item });
	emit("response.content_part.added", { item_id: itemId, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
	if (outcome.text.length > 0) emit("response.output_text.delta", { item_id: itemId, output_index: 0, content_index: 0, delta: outcome.text });
	emit("response.output_text.done", { item_id: itemId, output_index: 0, content_index: 0, text: outcome.text });
	emit("response.content_part.done", { item_id: itemId, output_index: 0, content_index: 0, part: { type: "output_text", text: outcome.text, annotations: [] } });
	const completed = { id: itemId, type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: outcome.text, annotations: [] }] };
	emit("response.output_item.done", { output_index: 0, item: completed });
	emit("response.completed", { response });
	res.end();
}
//#endregion

//#region plugin (agent gateway)
function apply(ctx, rawConfig) {
	const config = resolveConfig(rawConfig);
	const logger = typeof ctx.logger === "function" ? ctx.logger("openai-api") : { info() {}, warn() {}, error() {}, debug() {} };
	const agents = ctx.agents;
	const webServer = ctx.get("webServer");
	if (webServer === undefined) {
		logger.warn("openai-api: no webServer in context; endpoint not mounted");
		return;
	}
	const agentPresets = ctx.get("agentPresets");
	const agentDefaultModel = ctx.get("agentDefaultModel");
	if (agentPresets === undefined) logger.warn("openai-api: no agentPresets service; preset header values are opaque session keys");
	if (agentDefaultModel === undefined) logger.warn("openai-api: no agentDefaultModel service; requests without a real model id create sessions without a model");

	// Optional browser half: a sidebar entry showing the live base URL. It
	// publishes only an allowlisted descriptor, over the host's authenticated
	// /api route and as an authenticated page snapshot; each path degrades to a
	// no-op on a host that cannot provide it.
	mountUiStatus(ctx, config, webServer);
	mountUiSnapshot(ctx, config, webServer);

	const wireModel = config.model ?? "default";
	const sessionCwd = config.cwd ?? process.cwd();
	const acceptedKeys = config.apiKeys ?? [];
	// 角色会话持久化补丁（2026-09-05）：跨 dsh web 重启复用一个角色最后的
	// 未归档 dsh 会话。进程内 records 在宿主重启后清空，旧实现一律新建
	// （openai-api-<uuid>），导致同名角色会话堆积；这里把
	// (tenant, preset, X-Session-Id) -> dsh 会话 id 的映射持久化到磁盘，
	// 请求时先 agents.resume() 加载历史会话（未归档则继续用），
	// 归档/已销毁则回退 create 新会话并刷新映射。
	const SESSION_MAP_FILE = fileURLToPath(new URL("../../../../openai-session-map.json", import.meta.url));
	function sessionMapLoad() {
		try {
			const m = JSON.parse(readFileSync(SESSION_MAP_FILE, "utf8"));
			return typeof m === "object" && m !== null ? m : {};
		} catch (error) {
			return {};
		}
	}
	function sessionMapLookup(key) {
		const v = sessionMapLoad()[key];
		return v !== undefined && typeof v.id === "string" ? v.id : undefined;
	}
	function sessionMapSet(key, id) {
		try {
			const m = sessionMapLoad();
			m[key] = { id, ts: Date.now() };
			writeFileSync(SESSION_MAP_FILE, JSON.stringify(m, null, 1));
		} catch (error) {
			logger.warn(`openai-api: session map save skipped: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	const records = new Map(); // sessionKey -> SessionRecord
	const bySession = new Map(); // session.id -> SessionRecord
	const creating = new Set();
	let closed = false;
	let disposed = false;

	/** Settle one exact prompt only after admission, agent activity, and ordered assistant delivery reach quiescence. */
	const settleAfterQuiescence = (record, inflight) => {
		if (inflight.settlementStarted) return;
		inflight.settlementStarted = true;
		void (async () => {
			try {
				if (inflight.messageQueued) {
					await record.agent.whenIdle();
					await record.outputTail;
				}
				if (record.inflight !== inflight) return;
				record.inflight = undefined;
				if (inflight.cancelRequested) {
					inflight.resolve({ text: inflight.text, usage: inflight.usage, finish: "stop" });
					return;
				}
				if (inflight.agentError !== undefined) {
					inflight.reject(inflight.agentError);
					return;
				}
				if (inflight.outputError !== undefined) {
					inflight.reject(inflight.outputError);
					return;
				}
				const reason = inflight.endReason;
				if (reason === undefined) {
					inflight.reject(new Error("turn ended without a turn/end event"));
					return;
				}
				if (reason.kind === "error") {
					inflight.reject(new Error(`turn failed: ${reason.error.message}`));
					return;
				}
				inflight.resolve({ text: inflight.text, usage: inflight.usage, finish: finishReason(reason) });
			} catch (error) {
				inflight.reject(error instanceof Error ? error : new Error(String(error)));
			}
		})();
	};

	// ── session/event: committed assistant text + turn end ─────────
	const onSessionEvent = (session, event) => {
		const record = bySession.get(session.header.id);
		if (record === undefined || record.agent.session !== session) return;
		try {
			if (event.type === "assistant/message") {
				const inflight = record.inflight !== undefined && record.inflight.turn === event.data.turn ? record.inflight : undefined;
				if (inflight === undefined) return;
				const previous = record.outputTail;
				const delivery = previous.then(() => {
					let text = "";
					for (const block of event.data.message.content) {
						if (block.type === "text" && block.text !== "") text += text === "" ? block.text : `\n${block.text}`;
					}
					if (text === "") return;
					inflight.text += inflight.text === "" ? text : `\n\n${text}`;
					inflight.usage = addUsage(inflight.usage, event.data.usage);
					if (inflight.emit !== undefined) {
						inflight.emit(sseFrame(chunkBody({ id: inflight.completionId, created: inflight.created, model: inflight.model, delta: { content: text } })));
					}
				});
				record.outputTail = delivery.catch((error) => {
					if (inflight.outputError === undefined) inflight.outputError = error instanceof Error ? error : new Error(String(error));
					logger.warn(`openai-api: output delivery failed: ${error instanceof Error ? error.message : String(error)}`);
				});
			}
		} finally {
			const inflight = record.inflight;
			if (inflight !== undefined && event.type === "turn/end" && inflight.turn === event.data.turn) {
				if (inflight.endReason === undefined) inflight.endReason = event.data.reason;
				settleAfterQuiescence(record, inflight);
			}
		}
	};

	const onInboxClaimed = ({ agent, message, turn }) => {
		const record = bySession.get(agent.session.id);
		const inflight = record !== undefined && record.agent === agent ? record.inflight : undefined;
		if (inflight !== undefined && inflight.messageId === message.id) inflight.turn = turn;
	};

	const onAgentError = ({ agent, turn, error }) => {
		const record = bySession.get(agent.session.id);
		const inflight = record !== undefined && record.agent === agent ? record.inflight : undefined;
		if (record === undefined || inflight === undefined || !inflight.messageQueued || inflight.turn !== turn) return;
		inflight.agentError = error instanceof Error ? error : new Error(String(error));
		settleAfterQuiescence(record, inflight);
	};

	const disposeListeners = [
		ctx.on("session/event", onSessionEvent),
		ctx.on("agent/inbox/claimed", onInboxClaimed),
		ctx.on("agent/error", onAgentError),
	];

	// ── auth (apiKeys tenant model) ──────────────────────────────
	// No apiKeys => one keyless tenant (''), restricted to loopback so an
	// accidental LAN bind never exposes unauthenticated agent access. With
	// keys set, an exact `Bearer <key>` is required and the matched key is the
	// tenant (remote callers with the right key are allowed, like the
	// reference implementation).
	const requireAuth = (req) => {
		if (acceptedKeys.length === 0) {
			return isLoopbackAddress(req.socket?.remoteAddress) ? "" : undefined;
		}
		const header = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
		for (const key of acceptedKeys) {
			if (constantTimeEquals(header, `Bearer ${key}`)) return key;
		}
		return undefined;
	};

	const forget = (key, record) => {
		if (records.get(key) === record) records.delete(key);
		if (bySession.get(record.agent.session.id) === record) bySession.delete(record.agent.session.id);
	};

	// Shared per-endpoint session acquisition + prompt admission. Returns a
	// bound run that the caller awaits for the outcome.
	const acquireAndRun = async (req, res, body, request, isChat) => {
		const model = request.model ?? wireModel;
		const inflight = {
			completion: undefined,
			resolve: undefined,
			reject: undefined,
			messageId: "",
			messageQueued: false,
			turn: -1,
			endReason: undefined,
			text: "",
			usage: undefined,
			cancelRequested: false,
			settlementStarted: false,
			outputError: undefined,
			agentError: undefined,
			completionId: isChat ? newCompletionId() : newResponseId(),
			created: Math.floor(Date.now() / 1000),
			model,
			emit: undefined,
			includeUsage: request.includeUsage,
		};
		inflight.completion = new Promise((resolve, reject) => {
			inflight.resolve = resolve;
			inflight.reject = reject;
		});

		const sessionKey = req.openaiSessionKey;
		let existing = records.get(sessionKey);
		// 角色会话补丁（2026-09-02）：会话已被 dsh-web 归档 → 废弃并重建（新 dsh 会话）。
		// 归档只是 workspace 集合标记，agent 仍存活；不检查会导致后续请求 500/卡死 in flight。
		if (existing !== undefined) {
			const ws = ctx.get("workspaceRegistry");
			const archived = ws !== undefined && ws.archivedSessionIds !== undefined ? ws.archivedSessionIds : [];
			if (archived.includes(existing.agent.session.id)) {
				logger.warn(`openai-api: session ${existing.agent.session.id} archived; recreating`);
				forget(sessionKey, existing);
				await existing.dispose().catch(() => undefined);
				existing = undefined;
			}
		}
		let record;
		if (existing !== undefined) {
			record = existing;
		} else {
			creating.add(sessionKey);
			const selection = agentDefaultModel?.currentSelection?.();
			const agentOptions = {};
			agentOptions.provider = config.provider ?? selection?.provider;
			agentOptions.model = request.model !== undefined && request.model !== wireModel ? request.model : selection?.model;
			if (request.maxTokens !== undefined) agentOptions.maxTokens = request.maxTokens;

			let presetId;
			let setup;
			if (agentPresets !== undefined) {
				let row;
				try {
					row = await agentPresets.resolve(request.presetKey === "" ? undefined : request.presetKey);
				} catch (error) {
					creating.delete(sessionKey);
					const roster = await agentPresets.list().catch(() => undefined);
					const ids = roster !== undefined && roster.length > 0 ? roster.map((preset) => preset.id).join(", ") : "(none discovered)";
					logger.warn(`openai-api: unknown agent preset ${JSON.stringify(request.presetKey)}: ${error instanceof Error ? error.message : String(error)}`);
					sendJson(res, 400, errorBody(wireError(400, "invalid_request_error", `unknown agent preset ${JSON.stringify(request.presetKey)}; available presets: ${ids}`)));
					return { __envelope: true };
				}
				if (row.broken !== undefined) {
					creating.delete(sessionKey);
					const reason = row.broken === null || typeof row.broken !== "object" ? String(row.broken) : JSON.stringify(row.broken);
					sendJson(res, 400, errorBody(wireError(400, "invalid_request_error", `agent preset ${JSON.stringify(row.id)} is unusable: ${reason}`)));
					return { __envelope: true };
				}
				presetId = row.id;
				setup = async (agentCtx) => {
					await agentPresets.mount(agentCtx, presetId);
				};
			}

			const meta = { cwd: sessionCwd };
			if (presetId !== undefined) meta.agentPreset = presetId;
			let handle;
			// 角色会话持久化补丁（2026-09-05）：先尝试恢复该角色上次使用的
			// dsh 会话（跨宿主重启后 records 为空，旧实现直接新建会话导致
			// 同名会话堆积）；resume 失败（会话已销毁/不可恢复）或目标会话
			// 已归档时回退 create 新会话。
			const persistedId = sessionMapLookup(sessionKey);
			if (persistedId !== undefined) {
				try {
					const resumed = await agents.resume({
						resumeSessionId: persistedId,
						agentOptions,
						setup,
					});
					const ws0 = ctx.get("workspaceRegistry");
					const archived0 = ws0 !== undefined && ws0.archivedSessionIds !== undefined ? ws0.archivedSessionIds : [];
					if (archived0.includes(resumed.agent.session.id)) {
						logger.warn(`openai-api: resumed session ${persistedId} archived; recreating`);
						await resumed.dispose().catch(() => undefined);
					} else {
						handle = resumed;
						logger.info(`openai-api: resumed dsh session ${persistedId} (role=${req.openaiSessionId ?? ""})`);
					}
				} catch (error) {
					logger.warn(`openai-api: session resume failed (${error instanceof Error ? error.message : String(error)}); creating new`);
				}
			}
			if (handle === undefined) {
				try {
					handle = await agents.create({ sessionId: `openai-api-${randomUUID()}`, meta, agentOptions, setup });
				} catch (error) {
					creating.delete(sessionKey);
					logger.error(`openai-api: session creation failed for preset ${JSON.stringify(request.presetKey)}: ${error instanceof Error ? error.message : String(error)}`);
					sendJson(res, 500, errorBody(wireError(500, "api_error", `session creation failed: ${error instanceof Error ? error.message : String(error)}`)));
					return { __envelope: true };
				}
			}
			if (closed || disposed || req.openaiClientGone) {
				creating.delete(sessionKey);
				await handle.dispose().catch(() => undefined);
				if (!res.writableEnded) sendJson(res, 503, errorBody(wireError(503, "api_error", "the openai-api plugin is shutting down")));
				return { __envelope: true };
			}
			// Windows 本地补丁（2026-08-31）：会话创建后挂到对应 cwd 的工作区，
			// 否则会话在 web 端显示"未分组"（TUI/CLI 走 session-controller 会自动 attach）。
			// cwd 没有对应工作区时静默跳过（不擅自创建工作区）。
			try {
				const workspaceRegistry = ctx.get("workspaceRegistry");
				if (workspaceRegistry !== undefined) {
					const workspace = await workspaceRegistry.resolveByPath(sessionCwd);
					if (workspace !== undefined) await workspace.attachSession(handle.agent.session.id);
				}
			} catch (error) {
				logger.warn(`openai-api: workspace attach skipped: ${error instanceof Error ? error.message : String(error)}`);
			}
			// 角色会话补丁（2026-09-02）：X-Session-Id 非空 → 会话标题 = 角色名
			// （dsh-web 按角色名显示会话）。客户端对中文角色名 URL 编码，这里还原；
			// 标题为 user source（固定，不再自动生成）。
			if (req.openaiSessionId !== undefined && req.openaiSessionId !== "") {
				try {
					const titleSvc = ctx.get("sessionTitle");
					if (titleSvc !== undefined) {
						let title = req.openaiSessionId;
						try { title = decodeURIComponent(title); } catch (error) { /* 非编码值原样使用 */ }
						titleSvc.rename(handle.agent.session, title);
						logger.info(`openai-api: session titled ${JSON.stringify(title)}`);
					}
				} catch (error) {
					logger.warn(`openai-api: session title rename skipped: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
			record = { agent: handle.agent, dispose: () => handle.dispose(), outputTail: Promise.resolve(), inflight };
			records.set(sessionKey, record);
			bySession.set(record.agent.session.id, record);
			creating.delete(sessionKey);
			sessionMapSet(sessionKey, record.agent.session.id);
		}

		// Reserve the prompt slot, then queue.
		const message = { id: randomUUID(), role: "user", content: [{ type: "text", text: request.promptText }], source: { kind: "user" } };
		inflight.messageId = message.id;
		record.inflight = inflight;
		try {
			record.agent.followup(message);
		} catch (error) {
			record.inflight = undefined;
			// 角色会话补丁（2026-09-02）：无论新建还是复用，admission 失败都清理
			// （会话已失效/被归档），下次请求自动创建新会话，不再卡死 in flight。
			forget(sessionKey, record);
			await record.dispose().catch(() => undefined);
			inflight.reject(error instanceof Error ? error : new Error(String(error)));
			sendJson(res, 500, errorBody(wireError(500, "api_error", `prompt admission failed: ${error instanceof Error ? error.message : String(error)}`)));
			return { __envelope: true };
		}
		inflight.messageQueued = true;
		return { envelope: false, record, inflight };
	};

	// ── GET /v1/models ──────────────────────────────────────────
	const disposeRoutes = [
		webServer.register({
			kind: "exact",
			path: `${config.pathPrefix}/models`,
			handler: (req, res) => {
				if (!authorizeOptions(req, res, config)) return;
				if (req.method !== "GET") {
					sendJson(res, 405, errorBody(wireError(405, "invalid_request_error", "method not allowed: use GET")));
					return;
				}
				if (requireAuth(req) === undefined) {
					sendJson(res, 401, errorBody(wireError(401, "invalid_request_error", "invalid API key")));
					return;
				}
				sendJson(res, 200, modelsBody(wireModel));
			},
		}),
		webServer.register({
			kind: "exact",
			path: `${config.pathPrefix}/chat/completions`,
			handler: (req, res) => void handleChatCompletions(req, res),
		}),
		webServer.register({
			kind: "exact",
			path: `${config.pathPrefix}/responses`,
			handler: (req, res) => void handleResponses(req, res),
		}),
	];

	async function handleChatCompletions(req, res) {
		try {
			if (!authorizeOptions(req, res, config)) return;
			if (req.method !== "POST") {
				sendJson(res, 405, errorBody(wireError(405, "invalid_request_error", "method not allowed: use POST")));
				return;
			}
			const tenantKey = requireAuth(req);
			if (tenantKey === undefined) {
				sendJson(res, 401, errorBody(wireError(401, "invalid_request_error", "invalid API key")));
				return;
			}
			const presetRaw = req.headers["x-agent-preset"];
			if (Array.isArray(presetRaw) || (typeof presetRaw === "string" && presetRaw.includes(","))) {
				sendJson(res, 400, errorBody(wireError(400, "invalid_request_error", "x-agent-preset must be sent once, with a single preset id")));
				return;
			}
			const presetKey = typeof presetRaw === "string" ? presetRaw.trim() : "";
			// 角色会话补丁（2026-09-02）：X-Session-Id 头把会话身份扩展为
			// (tenant, preset, sessionId) —— 每个角色独立 dsh 会话；
			// sessionId 由客户端 URL 编码（中文角色名安全传输），创建时还原为会话标题。
			const sessionIdRaw = req.headers["x-session-id"];
			if (Array.isArray(sessionIdRaw) || (typeof sessionIdRaw === "string" && sessionIdRaw.includes(","))) {
				sendJson(res, 400, errorBody(wireError(400, "invalid_request_error", "x-session-id must be sent once, with a single value")));
				return;
			}
			const sessionIdKey = typeof sessionIdRaw === "string" ? sessionIdRaw.trim() : "";
			const sessionKey = tenantKey + "\0" + presetKey + "\0" + sessionIdKey;
			req.openaiSessionId = sessionIdKey;

			const body = await readJsonBody(req, res, config.maxBodyBytes);
			if (body === undefined) return;

			const existing = records.get(sessionKey);
			if (existing === undefined && creating.has(sessionKey)) {
				sendJson(res, 409, errorBody(wireError(409, "invalid_request_error", "this session is still being initialized; retry in a moment")));
				return;
			}
			const parsed = parseChatRequest(body, existing === undefined);
			if ("error" in parsed) {
				sendJson(res, parsed.error.status, errorBody(parsed.error));
				return;
			}
			const request = { ...parsed.value, presetKey };
			if (existing !== undefined && existing.inflight !== undefined) {
				sendJson(res, 409, errorBody(wireError(409, "invalid_request_error", "a prompt is already in flight for this session; retry when it completes")));
				return;
			}
			if (closed || disposed) {
				sendJson(res, 503, errorBody(wireError(503, "api_error", "the openai-api plugin is shutting down")));
				return;
			}

			let rec;
			req.openaiSessionKey = sessionKey;
			req.openaiClientGone = false;
			res.on("close", () => {
				req.openaiClientGone = true;
				if (rec !== undefined && rec.inflight !== undefined && rec.inflight.messageQueued && !rec.inflight.cancelRequested) {
					rec.inflight.cancelRequested = true;
					try {
						rec.agent.cancel({ kind: "user" });
					} catch {
						// agent disposed concurrently
					}
				}
			});

			const acquired = await acquireAndRun(req, res, body, request, true);
			if (acquired.__envelope === true || acquired.envelope === true) return;
			rec = acquired.record;
			const inflight = acquired.inflight;
			if (req.openaiClientGone && !inflight.messageQueued) {
				// The client disconnected before admission; settle as cancelled.
				inflight.cancelRequested = true;
			}

			const emit = (frame) => {
				if (res.writableEnded) return;
				try {
					res.write(frame);
				} catch {
					// client disconnected mid-stream; the close listener cancels
				}
			};
			if (request.stream) {
				inflight.emit = emit;
				res.writeHead(200, { ...securityHeaders(), "content-type": "text/event-stream", connection: "keep-alive", "x-accel-buffering": "no" });
				res.flushHeaders();
				emit(sseFrame(chunkBody({ id: inflight.completionId, created: inflight.created, model: inflight.model, delta: { role: "assistant", content: "" } })));
			}

			try {
				const outcome = await inflight.completion;
				if (res.writableEnded) return;
				if (request.stream) {
					emit(sseFrame(chunkBody({ id: inflight.completionId, created: inflight.created, model: inflight.model, delta: {}, finish: outcome.finish })));
					const usage = usageBody(outcome.usage);
					if (inflight.includeUsage && usage !== undefined) {
						emit(sseFrame({ id: inflight.completionId, object: "chat.completion.chunk", created: inflight.created, model: inflight.model, choices: [], usage }));
					}
					emit(SSE_DONE);
					res.end();
				} else {
					sendJson(res, 200, completionBody({ id: inflight.completionId, created: inflight.created, model: inflight.model, outcome }));
				}
			} catch (error) {
				const text = error instanceof Error ? error.message : String(error);
				if (request.stream) {
					logger.warn(`openai-api: streaming turn failed for preset ${JSON.stringify(presetKey)}: ${text}`);
					if (!res.writableEnded) res.end();
				} else {
					logger.warn(`openai-api: turn failed for preset ${JSON.stringify(presetKey)}: ${text}`);
					sendJson(res, 500, errorBody(wireError(500, "api_error", `turn failed: ${text}`)));
				}
			}
		} catch (error) {
			logger.warn(`openai-api: unhandled chat error: ${error instanceof Error ? error.stack : String(error)}`);
			sendJson(res, 500, errorBody(wireError(500, "api_error", error instanceof Error ? error.message : String(error))));
		}
	}

	async function handleResponses(req, res) {
		try {
			if (!authorizeOptions(req, res, config)) return;
			if (req.method !== "POST") {
				sendJson(res, 405, errorBody(wireError(405, "invalid_request_error", "method not allowed: use POST")));
				return;
			}
			const tenantKey = requireAuth(req);
			if (tenantKey === undefined) {
				sendJson(res, 401, errorBody(wireError(401, "invalid_request_error", "invalid API key")));
				return;
			}
			const presetRaw = req.headers["x-agent-preset"];
			if (Array.isArray(presetRaw) || (typeof presetRaw === "string" && presetRaw.includes(","))) {
				sendJson(res, 400, errorBody(wireError(400, "invalid_request_error", "x-agent-preset must be sent once, with a single preset id")));
				return;
			}
			const presetKey = typeof presetRaw === "string" ? presetRaw.trim() : "";
			// 角色会话补丁（2026-09-02）：X-Session-Id 头把会话身份扩展为
			// (tenant, preset, sessionId) —— 每个角色独立 dsh 会话；
			// sessionId 由客户端 URL 编码（中文角色名安全传输），创建时还原为会话标题。
			const sessionIdRaw = req.headers["x-session-id"];
			if (Array.isArray(sessionIdRaw) || (typeof sessionIdRaw === "string" && sessionIdRaw.includes(","))) {
				sendJson(res, 400, errorBody(wireError(400, "invalid_request_error", "x-session-id must be sent once, with a single value")));
				return;
			}
			const sessionIdKey = typeof sessionIdRaw === "string" ? sessionIdRaw.trim() : "";
			const sessionKey = tenantKey + "\0" + presetKey + "\0" + sessionIdKey;
			req.openaiSessionId = sessionIdKey;

			const body = await readJsonBody(req, res, config.maxBodyBytes);
			if (body === undefined) return;

			const existing = records.get(sessionKey);
			if (existing === undefined && creating.has(sessionKey)) {
				sendJson(res, 409, errorBody(wireError(409, "invalid_request_error", "this session is still being initialized; retry in a moment")));
				return;
			}
			const orchestrated = orchestrateResponses(body, existing === undefined);
			if ("error" in orchestrated) {
				sendJson(res, orchestrated.error.status, errorBody(orchestrated.error));
				return;
			}
			const request = { ...orchestrated.value, presetKey };
			if (existing !== undefined && existing.inflight !== undefined) {
				sendJson(res, 409, errorBody(wireError(409, "invalid_request_error", "a prompt is already in flight for this session; retry when it completes")));
				return;
			}
			if (closed || disposed) {
				sendJson(res, 503, errorBody(wireError(503, "api_error", "the openai-api plugin is shutting down")));
				return;
			}

			let rec;
			req.openaiSessionKey = sessionKey;
			req.openaiClientGone = false;
			res.on("close", () => {
				req.openaiClientGone = true;
				if (rec !== undefined && rec.inflight !== undefined && rec.inflight.messageQueued && !rec.inflight.cancelRequested) {
					rec.inflight.cancelRequested = true;
					try {
						rec.agent.cancel({ kind: "user" });
					} catch {
						// agent disposed concurrently
					}
				}
			});

			const acquired = await acquireAndRun(req, res, body, request, false);
			if (acquired.__envelope === true || acquired.envelope === true) return;
			rec = acquired.record;
			const inflight = acquired.inflight;
			if (req.openaiClientGone && !inflight.messageQueued) {
				inflight.cancelRequested = true;
			}

			if (request.stream) {
				res.writeHead(200, { ...securityHeaders(), "content-type": "text/event-stream", connection: "keep-alive", "x-accel-buffering": "no" });
				res.flushHeaders();
			}

			try {
				const outcome = await inflight.completion;
				if (res.writableEnded) return;
				if (request.stream) {
					emitResponsesStream(res, inflight, outcome, request.instructions);
				} else {
					sendJson(res, 200, responseBody(inflight.completionId, inflight.created, inflight.model, outcome, request.instructions));
				}
			} catch (error) {
				const text = error instanceof Error ? error.message : String(error);
				logger.warn(`openai-api: responses turn failed for preset ${JSON.stringify(presetKey)}: ${text}`);
				if (responseEnded(res)) return;
				if (request.stream && res.headersSent) {
					res.end(`event: error\ndata: ${JSON.stringify({ type: "error", sequence_number: 1, code: "server_error", message: `turn failed: ${text}`, param: null })}\n\n`);
				} else {
					sendJson(res, 500, errorBody(wireError(500, "api_error", `turn failed: ${text}`)));
				}
			}
		} catch (error) {
			logger.warn(`openai-api: unhandled responses error: ${error instanceof Error ? error.stack : String(error)}`);
			sendJson(res, 500, errorBody(wireError(500, "api_error", error instanceof Error ? error.message : String(error))));
		}
	}

	// ── teardown ────────────────────────────────────────────────
	ctx.effect(() => {
		return async () => {
			closed = true;
			const all = [...records.values()];
			for (const record of all) {
				if (record.inflight !== undefined) record.inflight.cancelRequested = true;
				try {
					record.agent.cancel({ kind: "user" });
				} catch {
					// already disposed
				}
			}
			await Promise.all(
				all.map(async (record) => {
					if (record.inflight !== undefined && record.inflight.messageQueued) await record.agent.whenIdle();
					await record.outputTail;
				}),
			);
			for (const record of all) {
				const inflight = record.inflight;
				if (inflight !== undefined && !inflight.settlementStarted) {
					inflight.settlementStarted = true;
					inflight.reject(new Error("the openai-api plugin is shutting down"));
				}
			}
			await Promise.allSettled(all.map((record) => record.dispose()));
			records.clear();
			bySession.clear();
			for (const dispose of disposeRoutes) dispose();
			for (const dispose of disposeListeners) dispose();
			disposed = true;
			logger.info("openai-api: disposed");
		};
	}, "openai-api teardown");

	logger.info("openai-api: agent-backed at %s (models / chat.completions / responses)", config.pathPrefix);
}

export { apply, inject, name };
//#endregion
