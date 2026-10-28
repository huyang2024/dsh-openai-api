/**
 * Standalone smoke test for the agent-backed dsh-openai-api.
 *
 * Drives the real plugin against a faked `agents` service plus faked
 * `session/event` / `agent/inbox/claimed` dispatch. The fake agent emits its
 * turn events on microtasks queued by `followup`, so the handler's `await completion` resolves
 * naturally while exercising transcript seeding, latest-turn admission,
 * preset resolution, auth, and both wire formats — without a live agent.
 */
import { createServer } from "node:http";
import assert from "node:assert";
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { apply } from "../lib/index.js";

//#region fakes
function makeCtx(config) {
	const directory = realpathSync(mkdtempSync(join(tmpdir(), "openai-api-smoke-")));
	const listeners = new Map();
	const routes = new Map();
	const createLog = [];
	let lastHandle = null;
	const turnScript = { text: "Hello world.", usage: { inputTokens: 5, outputTokens: 3, cacheReadTokens: 2 }, reason: { kind: "stop" }, turn: 1 };

	// Emit into the plugin's registered listeners.
	const emit = (event, ...args) => {
		for (const handler of listeners.get(event) ?? []) handler(...args);
	};

	const agents = {
		async create({ sessionId, meta, agentOptions, setup }) {
			const agent = {
				id: sessionId,
				options: agentOptions,
				// The real harness Session exposes both `id` (stable identity, used
				// by the plugin's bySession map key) and `header.id` (durable id,
				// used for event lookups). They are the same value.
				session: { id: sessionId, header: { id: sessionId } },
				disposed: false,
				followup(message) {
					agent.lastMessage = message;
					// Real followup only queues; the agent loops asynchronously, so
					// its session/event fire on a later tick — after the handler has
					// assigned inflight.emit. Mirror that by deferring the turn.
					const script = env.turnScript;
					queueMicrotask(() => emit("agent/inbox/claimed", { agent, message, turn: script.turn }));
					queueMicrotask(() => emit("session/event", agent.session, { type: "assistant/message", data: { turn: script.turn, step: 0, message: { content: [{ type: "text", text: script.text }] }, usage: script.usage } }));
					queueMicrotask(() => emit("session/event", agent.session, { type: "turn/end", data: { turn: script.turn, reason: script.reason } }));
				},
				async whenIdle() {},
				cancel() {},
				dispose() {
					agent.disposed = true;
					return Promise.resolve();
				},
			};
			if (setup) await setup({ get() { return undefined; } });
			createLog.push({ sessionId, meta, agentOptions });
			lastHandle = { agent, dispose: () => agent.dispose() };
			return lastHandle;
		},
	};
	const agentPresets = {
		resolve: async (id) => (id === undefined ? { id: "standard" } : { id }),
		list: async () => [{ id: "standard" }, { id: "code" }],
		mount: async (agentCtx, id) => { void agentCtx; void id; },
	};

	const env = {
		turnScript,
		emit,
		teardownEffects: [],
		sessionMapPath: join(directory, "session-map.json"),
		async dispose() {
			await Promise.allSettled(env.teardownEffects.splice(0).map((dispose) => dispose()));
			// Only remove the exact temporary directory this fixture created.
			assert.strictEqual(realpathSync(directory), directory);
			rmSync(directory, { recursive: true });
		},
		ctx: {
			agents,
			webServer: {
				register(route) {
					routes.set(route.path, route.handler);
					return () => routes.delete(route.path);
				},
			},
			agentPresets,
			agentDefaultModel: { currentSelection() { return { provider: "stub-provider", model: "stub-model" }; } },
			logger(name) { return { info() {}, warn() {}, error() {}, debug() {} }; },
			on(event, handler) {
				const list = listeners.get(event) ?? [];
				list.push(handler);
				listeners.set(event, list);
				return () => {
					const current = listeners.get(event);
					const index = current.indexOf(handler);
					if (index >= 0) current.splice(index, 1);
				};
			},
			effect(fn) {
				const disposer = fn();
				env.teardownEffects.push(disposer);
				return disposer;
			},
			get(name) { return this[name]; },
		},
		routes,
		createLog,
		lastAgent: () => lastHandle?.agent ?? null,
		setTurn(script) { env.turnScript = script; },
	};
	// The session map is real file I/O; keep every case inside a throwaway dir.
	try {
		apply(env.ctx, { sessionMapPath: env.sessionMapPath, ...config });
	} catch (error) {
		// Invalid configuration cannot leave a live route or agent behind.
		assert.strictEqual(realpathSync(directory), directory);
		rmSync(directory, { recursive: true });
		throw error;
	}
	return env;
}

async function listen(fetchLike) {
	const server = createServer((req, res) => fetchLike(req, res));
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return { server, url: `http://127.0.0.1:${server.address().port}` };
}

/**
 * Drive one case against a freshly applied plugin served over loopback.
 *
 * @param config - plugin configuration for this case.
 * @param body - receives (env, url) and owns its assertions.
 * @param decorate - optional wrapper around the request handler.
 */
async function withPlugin(config, body, decorate = (handler) => handler) {
	const env = makeCtx(config);
	const { server, url } = await listen(decorate((req, res) => env.routes.get(new URL(req.url, "http://x").pathname)(req, res)));
	try {
		await body(env, url);
	} finally {
		await new Promise((resolve) => server.close(resolve));
		await env.dispose();
	}
}

async function request(url, path, { method = "GET", body, headers = {} } = {}) {
	const opts = { method, headers: { ...headers }, signal: AbortSignal.timeout(3000) };
	if (body !== undefined) {
		opts.headers["content-type"] = "application/json";
		opts.body = JSON.stringify(body);
	}
	const res = await fetch(`${url}${path}`, opts);
	return { status: res.status, text: await res.text(), headers: res.headers };
}

function parseChunkEvents(text) {
	return text.trim().split("\n\n").map((block) => {
		const data = block.match(/^data: (.*)$/m)[1];
		return { event: block.match(/^event: (.+)$/m)?.[1], data: data === "[DONE]" ? data : JSON.parse(data) };
	});
}
//#endregion

async function main() {
	for (const [key, value] of [["model", ""], ["provider", ""], ["pathPrefix", ""], ["cwd", "relative"], ["sessionMapPath", "relative"], ["apiKeys", [""]], ["allowedOrigins", [""]], ["maxBodyBytes", 1], ["unknown", true]]) {
		assert.throws(() => makeCtx({ [key]: value }), /openai-api config/);
	}
	await withPlugin({}, async (env, url) => {
		//#region GET /v1/models
		{
			const res = await request(url, "/v1/models");
			assert.strictEqual(res.status, 200);
			const body = JSON.parse(res.text);
			assert.strictEqual(body.object, "list");
			assert.strictEqual(body.data[0].id, "default");
			console.log("models OK");
		}
		//#endregion

		//#region chat non-stream first request (transcript seed)
		{
			env.setTurn({ text: "Four.", usage: { inputTokens: 9, outputTokens: 4 }, reason: { kind: "stop" }, turn: 1 });
			const res = await request(url, "/v1/chat/completions", { method: "POST", body: {
				messages: [
					{ role: "system", content: "You are concise." },
					{ role: "user", content: "What is 2+2?" },
				],
			} });
			assert.strictEqual(res.status, 200);
			const body = JSON.parse(res.text);
			assert.strictEqual(body.object, "chat.completion");
			assert.strictEqual(body.choices[0].message.content, "Four.");
			assert.strictEqual(body.choices[0].finish_reason, "stop");
			assert.strictEqual(body.usage.prompt_tokens, 9 + 0); // input 9 + cache 0
			assert.strictEqual(body.usage.total_tokens, 9 + 4);
			// The first request's full array was rendered into the transcript prompt.
			assert.ok(env.lastAgent().lastMessage.content[0].text.includes("[system] You are concise."));
			assert.ok(env.lastAgent().lastMessage.content[0].text.includes("[user] What is 2+2?"));
			console.log("chat first-request transcript seed OK");
		}
		//#endregion

		//#region chat second request admits only latest user turn
		{
			env.setTurn({ text: "OK", usage: { inputTokens: 3, outputTokens: 1 }, reason: { kind: "stop" }, turn: 1 });
			const res = await request(url, "/v1/chat/completions", { method: "POST", body: {
				messages: [
					{ role: "user", content: "first turn in replayed history" },
					{ role: "assistant", content: "ack" },
					{ role: "user", content: "latest turn" },
				],
			} });
			assert.strictEqual(res.status, 200);
			const body = JSON.parse(res.text);
			// The admitted prompt is the latest user turn, NOT the transcript.
			assert.strictEqual(env.lastAgent().lastMessage.content[0].text, "latest turn");
			assert.strictEqual(body.choices[0].message.content, "OK");
			// No new session was created.
			assert.strictEqual(env.createLog.length, 1);
			console.log("chat second-request latest-turn admission OK");
		}
		//#endregion

		//#region chat streaming: one content delta per committed message, then [DONE]
		{
			env.setTurn({ text: "streamed reply", usage: { inputTokens: 7, outputTokens: 3 }, reason: { kind: "stop" }, turn: 1 });
			const res = await request(url, "/v1/chat/completions", { method: "POST", body: {
				messages: [{ role: "user", content: "go" }],
				stream: true,
				stream_options: { include_usage: true },
			} });
			assert.strictEqual(res.status, 200);
			assert.match(res.text, /^data: /m);
			const events = parseChunkEvents(res.text).map((event) => event.data);
			const roleFrame = events.find((e) => e.choices?.[0]?.delta?.role === "assistant");
			const contentFrame = events.find((e) => e.choices?.[0]?.delta?.content);
			const finishFrame = events.find((e) => e.choices?.[0]?.finish_reason !== null && e.choices?.[0]?.delta?.content === undefined);
			const usageFrame = events.find((e) => e.choices?.length === 0 && e.usage !== undefined);
			assert.ok(roleFrame);
			assert.strictEqual(contentFrame.choices[0].delta.content, "streamed reply");
			assert.strictEqual(finishFrame.choices[0].finish_reason, "stop");
			assert.ok(usageFrame && usageFrame.usage.total_tokens === 10);
			assert.ok(res.text.endsWith("data: [DONE]\n\n"));
			console.log("chat stream OK");
		}
		//#endregion

		//#region preset header resolves and joins
		await withPlugin({}, async (env, url) => {
			env.setTurn({ text: "hi", usage: { inputTokens: 1, outputTokens: 1 }, reason: { kind: "stop" }, turn: 1 });
			const res = await request(url, "/v1/chat/completions", { method: "POST", body: { messages: [{ role: "user", content: "hi" }] }, headers: { "x-agent-preset": "code" } });
			assert.strictEqual(res.status, 200);
			assert.strictEqual(env.createLog[0].meta.agentPreset, "code");
			console.log("preset header join OK");
		});
		//#endregion

		//#region apiKeys auth
		await withPlugin({ apiKeys: ["local-key"] }, async (env, url) => {
			assert.strictEqual((await fetch(`${url}/v1/models`)).status, 401);
			assert.strictEqual((await request(url, "/v1/models", { headers: { authorization: "Bearer wrong" } })).status, 401);
			env.setTurn({ text: "ok", usage: { inputTokens: 1, outputTokens: 1 }, reason: { kind: "stop" }, turn: 1 });
			const chat = await request(url, "/v1/chat/completions", { method: "POST", body: { messages: [{ role: "user", content: "hi" }] }, headers: { authorization: "Bearer local-key" } });
			assert.strictEqual(chat.status, 200);
			assert.strictEqual((await request(url, "/v1/models", { headers: { authorization: "Bearer local-key" } })).status, 200);
			console.log("apiKeys auth OK");
		});
		//#endregion

		//#region loopback-only when no apiKeys: a non-loopback peer is refused
		await withPlugin({}, async (env, url) => {
			assert.strictEqual((await fetch(`${url}/v1/models`)).status, 401);
			console.log("loopback-only guard OK");
		}, (handler) => (req, res) => {
			// Pretend the connection came from a LAN peer by shadowing the
			// read-only remoteAddress getter on the socket instance.
			Object.defineProperty(req.socket, "remoteAddress", { value: "10.0.0.5", configurable: true });
			handler(req, res);
		});
		//#endregion

		//#region tools & tool-role rejected (agent owns tool use)
		{
			env.setTurn({ text: "x", usage: { inputTokens: 1, outputTokens: 1 }, reason: { kind: "stop" }, turn: 1 });
			const toolsRes = await request(url, "/v1/chat/completions", { method: "POST", body: { messages: [{ role: "user", content: "hi" }], tools: [{ type: "function", function: { name: "f" } }] } });
			assert.strictEqual(toolsRes.status, 400);
			assert.match(JSON.parse(toolsRes.text).error.message, /function calling/);
			console.log("tools rejected OK");
		}
		//#endregion

		//#region unknown preset -> 400 with roster
		await withPlugin({}, async (env, url) => {
			env.ctx.agentPresets.resolve = async (id) => {
				if (id !== undefined && id !== "standard" && id !== "code") throw new Error("unknown preset");
				return { id: id ?? "standard" };
			};
			const res = await request(url, "/v1/chat/completions", { method: "POST", body: { messages: [{ role: "user", content: "hi" }] }, headers: { "x-agent-preset": "nope" } });
			assert.strictEqual(res.status, 400);
			assert.match(JSON.parse(res.text).error.message, /available presets/);
			console.log("unknown preset 400 OK");
		});
		//#endregion

		//#region /v1/responses non-stream + stream
		{
			env.setTurn({ text: "responses answer", usage: { inputTokens: 6, outputTokens: 2 }, reason: { kind: "stop" }, turn: 1 });
			const res = await request(url, "/v1/responses", { method: "POST", body: { input: "hello", instructions: "Be brief." } });
			assert.strictEqual(res.status, 200);
			const body = JSON.parse(res.text);
			assert.strictEqual(body.object, "response");
			assert.strictEqual(body.status, "completed");
			assert.strictEqual(body.output[0].content[0].text, "responses answer");
			assert.strictEqual(body.instructions, "Be brief.");
			assert.strictEqual(body.usage.input_tokens, 6);

			env.setTurn({ text: "streamed response", usage: { inputTokens: 2, outputTokens: 1 }, reason: { kind: "stop" }, turn: 1 });
			const sres = await request(url, "/v1/responses", { method: "POST", body: { input: "go", stream: true } });
			assert.strictEqual(sres.status, 200);
			const blocks = parseChunkEvents(sres.text);
			const names = blocks.map((b) => b.event);
			assert.deepStrictEqual(names.slice(0, 2), ["response.created", "response.in_progress"]);
			assert.ok(names.includes("response.output_text.delta"));
			const completed = blocks.find((b) => b.event === "response.completed");
			assert.strictEqual(completed.data.response.output[0].content[0].text, "streamed response");
			// Every event and the final body must name the same output item.
			const announced = blocks.find((b) => b.event === "response.output_item.added").data.item.id;
			const closed = blocks.find((b) => b.event === "response.output_item.done").data.item.id;
			assert.strictEqual(announced, closed);
			assert.strictEqual(announced, completed.data.response.output[0].id);
			console.log("responses non-stream + stream OK");
		}
		//#endregion

		//#region failed Responses stream stays SSE and leaves the server usable
		{
			env.setTurn({ text: "", reason: { kind: "error", error: { message: "provider unavailable" } }, turn: 2 });
			const res = await request(url, "/v1/responses", { method: "POST", body: { input: "go", stream: true } });
			assert.strictEqual(res.status, 200); // SSE headers were already sent.
			assert.match(res.headers.get("content-type"), /text\/event-stream/);
			const events = parseChunkEvents(res.text);
			// The stream opens before the turn runs, so a client is never left
			// waiting on a long answer; the failure then closes it explicitly.
			assert.deepStrictEqual(events.slice(0, 2).map((event) => event.event), ["response.created", "response.in_progress"]);
			const failure = events.at(-1);
			assert.strictEqual(failure.event, "error");
			assert.strictEqual(failure.data.code, "server_error");
			assert.match(failure.data.message, /provider unavailable/);
			const sequence = events.map((event) => event.data.sequence_number);
			assert.deepStrictEqual(sequence, events.map((_, index) => index + 1), "sequence numbers stay consecutive");
			assert.strictEqual((await request(url, "/v1/models")).status, 200);
			env.setTurn({ text: "recovered", reason: { kind: "stop" }, turn: 3 });
			const recovered = await request(url, "/v1/responses", { method: "POST", body: { input: "retry" } });
			assert.strictEqual(JSON.parse(recovered.text).output[0].content[0].text, "recovered");
			console.log("responses stream failure and recovery OK");
		}
		//#endregion

		//#region a null end reason and a partial usage report are survived
		{
			// `reason: null` used to raise a TypeError, turning a finished turn into
			// a 500; a usage report missing counters used to serialize as null.
			env.setTurn({ text: "still fine", usage: { outputTokens: 3 }, reason: null, turn: 1 });
			const res = await request(url, "/v1/chat/completions", { method: "POST", body: { messages: [{ role: "user", content: "hi" }] } });
			assert.strictEqual(res.status, 200);
			const body = JSON.parse(res.text);
			assert.strictEqual(body.choices[0].message.content, "still fine");
			assert.strictEqual(body.choices[0].finish_reason, "stop");
			assert.deepStrictEqual(body.usage, { prompt_tokens: 0, completion_tokens: 3, total_tokens: 3 });
			console.log("null end reason and partial usage OK");
		}
		//#endregion

		//#region a chat stream that dies mid-turn ends explicitly
		{
			env.setTurn({ text: "", reason: { kind: "error", error: { message: "provider unavailable" } }, turn: 4 });
			const res = await request(url, "/v1/chat/completions", { method: "POST", body: { messages: [{ role: "user", content: "go" }], stream: true } });
			assert.strictEqual(res.status, 200);
			// A bare end() would look like a complete answer to the client.
			assert.match(res.text, /"error":\{"message":"turn failed: provider unavailable"/);
			assert.ok(res.text.endsWith("data: [DONE]\n\n"), "the stream still terminates explicitly");
			console.log("chat stream failure frame OK");
		}
		//#endregion

		//#region responses reports truncation and echoes the previous response id
		{
			env.setTurn({ text: "cut off", reason: { kind: "max-tokens" }, turn: 5 });
			const res = await request(url, "/v1/responses", { method: "POST", body: { input: "go", previous_response_id: "resp_prev" } });
			const body = JSON.parse(res.text);
			assert.strictEqual(body.status, "incomplete");
			assert.deepStrictEqual(body.incomplete_details, { reason: "max_output_tokens" });
			assert.strictEqual(body.previous_response_id, "resp_prev");
			console.log("responses truncation and previous_response_id OK");
		}
		//#endregion

		//#region a Responses request cannot smuggle tools past the agent
		{
			const res = await request(url, "/v1/responses", { method: "POST", body: { input: "hi", tools: [{ type: "function", name: "f" }] } });
			assert.strictEqual(res.status, 400);
			assert.match(JSON.parse(res.text).error.message, /function calling/);
			console.log("responses tools rejected OK");
		}
		//#endregion

		//#region an explicit empty apiKeys list behaves like omitting it
		await withPlugin({ apiKeys: [] }, async (env, url) => {
			void env;
			assert.strictEqual((await request(url, "/v1/models")).status, 200);
			console.log("explicit empty apiKeys OK");
		});
		//#endregion

		//#region admission failure answers 500 and leaves no unhandled rejection
		await withPlugin({}, async (env, url) => {
			const create = env.ctx.agents.create;
			env.ctx.agents.create = async (...args) => {
				const handle = await create(...args);
				handle.agent.followup = () => {
					throw new Error("admission boom");
				};
				return handle;
			};
			const rejections = [];
			const onRejection = (reason) => rejections.push(reason);
			process.on("unhandledRejection", onRejection);
			try {
				assert.strictEqual((await request(url, "/v1/chat/completions", { method: "POST", body: { messages: [{ role: "user", content: "hi" }] } })).status, 500);
				// An unhandled rejection surfaces on a later tick, and terminates a
				// Node host by default.
				await new Promise((resolve) => setTimeout(resolve, 30));
				assert.deepStrictEqual(rejections.map(String), [], "a refused admission must not leave a rejected promise unconsumed");
				console.log("admission failure without unhandled rejection OK");
			} finally {
				process.off("unhandledRejection", onRejection);
			}
		});
		//#endregion

		//#region events stay bound to their exact turn and ordered output
		await withPlugin({}, async (env, url) => {
			await request(url, "/v1/chat/completions", { method: "POST", body: { messages: [{ role: "user", content: "seed" }] } });
			const agent = env.lastAgent();
			agent.followup = (message) => queueMicrotask(() => {
				env.emit("agent/inbox/claimed", { agent, message, turn: 7 });
				env.emit("session/event", agent.session, { type: "unrelated" });
				for (const [turn, text] of [[8, "wrong turn"], [7, "first"], [7, "second"]]) {
					env.emit("session/event", agent.session, { type: "assistant/message", data: { turn, message: { content: [{ type: "reasoning", text: "private" }, { type: "text", text }] }, usage: { inputTokens: 2, outputTokens: 1 } } });
				}
				env.emit("session/event", agent.session, { type: "turn/end", data: { turn: 7, reason: { kind: "stop" } } });
			});
			const result = await request(url, "/v1/chat/completions", { method: "POST", body: { messages: [{ role: "user", content: "go" }] } });
			assert.equal(result.status, 200);
			const body = JSON.parse(result.text);
			assert.equal(body.choices[0].message.content, "first\n\nsecond");
			assert.deepEqual(body.usage, { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 });
		});
		console.log("ordered output and event isolation OK");
		//#endregion

		//#region initialization reserves one slot until every awaited setup completes
		await withPlugin({}, async (env, url) => {
			let announce, release;
			const entered = new Promise((resolve) => { announce = resolve; });
			const blocked = new Promise((resolve) => { release = resolve; });
			const resolvePreset = env.ctx.agentPresets.resolve;
			env.ctx.agentPresets.resolve = async (id) => { announce(); await blocked; return resolvePreset(id); };
			const body = { messages: [{ role: "user", content: "hi" }] };
			const first = request(url, "/v1/chat/completions", { method: "POST", body });
			await entered;
			try {
				assert.equal((await request(url, "/v1/responses", { method: "POST", body: { input: "hi" } })).status, 409);
			} finally { release(); }
			assert.equal((await first).status, 200);
			assert.equal(env.createLog.length, 1);
		});
		console.log("shared initialization gate OK");
		//#endregion

		//#region creation failures always release the shared admission gate
		for (const [path, body] of [
			["/v1/chat/completions", { messages: [{ role: "user", content: "hello" }] }],
			["/v1/responses", { input: "hello" }],
		]) {
			await withPlugin({}, async (env, url) => {
				const selection = env.ctx.agentDefaultModel.currentSelection;
				env.ctx.agentDefaultModel.currentSelection = () => { throw new Error("selection failed"); };
				assert.equal((await request(url, path, { method: "POST", body })).status, 500);
				env.ctx.agentDefaultModel.currentSelection = selection;
				assert.equal((await request(url, path, { method: "POST", body })).status, 200);
				const agent = env.lastAgent();
				agent.whenIdle = async () => { throw new Error("idle failed"); };
				assert.equal((await request(url, path, { method: "POST", body })).status, 500);
				agent.whenIdle = async () => {};
				assert.equal((await request(url, path, { method: "POST", body })).status, 200, "idle failure must not leave the session stuck at 409");
			});
		}
		console.log("both endpoint gates recover after creation and idle failures OK");
		//#endregion

		//#region Responses conversion preserves instructions, usage and all tool refusals
		await withPlugin({}, async (env, url) => {
			env.setTurn({ text: "ok", usage: { inputTokens: 5, outputTokens: 2, cacheReadTokens: 3, reasoningTokens: 4 }, reason: { kind: "stop" }, turn: 1 });
			const result = await request(url, "/v1/responses", { method: "POST", body: { input: "hello", instructions: "Be brief." } });
			assert.equal(result.status, 200);
			assert.match(env.lastAgent().lastMessage.content[0].text, /\[system\] Be brief\./);
			assert.deepEqual(JSON.parse(result.text).usage, { input_tokens: 8, output_tokens: 6, total_tokens: 14, input_tokens_details: { cached_tokens: 3 }, output_tokens_details: { reasoning_tokens: 4 } });
			for (const key of ["tools", "tool_choice", "functions", "function_call"]) {
				assert.equal((await request(url, "/v1/responses", { method: "POST", body: { input: "hi", [key]: null } })).status, 400);
			}
		});
		console.log("Responses instructions, usage details and tool refusals OK");
		//#endregion

		//#region session map is private and stays in the fixture directory
		await withPlugin({ apiKeys: ["test-secret"] }, async (env, url) => {
			await request(url, "/v1/chat/completions", { method: "POST", headers: { authorization: "Bearer test-secret" }, body: { messages: [{ role: "user", content: "hi" }] } });
			const content = readFileSync(env.sessionMapPath, "utf8");
			assert.equal(content.includes("test-secret"), false);
			assert.match(Object.keys(JSON.parse(content))[0], /^[a-f0-9]{32}$/);
			if (process.platform !== "win32") assert.equal(statSync(env.sessionMapPath).mode & 0o777, 0o600);
		});
		console.log("private session mapping OK");
		//#endregion

		//#region cross-origin fence is independent of the API key
		await withPlugin({ apiKeys: ["local-key"], allowedOrigins: ["https://allowed.test"] }, async (env, url) => {
			void env;
			{
				// A valid key does not buy a foreign browser origin a way in.
				const foreign = await request(url, "/v1/models", { headers: { origin: "https://evil.test", authorization: "Bearer local-key" } });
				assert.strictEqual(foreign.status, 403);

				const listed = await request(url, "/v1/models", { headers: { origin: "https://allowed.test", authorization: "Bearer local-key" } });
				assert.strictEqual(listed.status, 200);
				assert.strictEqual(listed.headers.get("access-control-allow-origin"), "https://allowed.test");

				const preflight = await fetch(`${url}/v1/chat/completions`, { method: "OPTIONS", headers: { origin: "https://allowed.test", "access-control-request-method": "POST" } });
				assert.strictEqual(preflight.status, 204);
				assert.strictEqual(preflight.headers.get("access-control-allow-origin"), "https://allowed.test");

				const unknownPreflight = await fetch(`${url}/v1/chat/completions`, { method: "OPTIONS", headers: { origin: "https://evil.test", "access-control-request-method": "POST" } });
				assert.strictEqual(unknownPreflight.status, 403);
			}
			console.log("cross-origin fence independent of apiKeys OK");
		});
		//#endregion

		//#region teardown disposes held sessions and unmounts routes
		{
			assert.ok((env.teardownEffects?.length ?? 0) >= 1);
			await env.teardownEffects.at(-1)();
			assert.strictEqual(env.lastAgent().disposed, true, "the held agent is disposed");
			assert.strictEqual(env.routes.has("/v1/models"), false, "routes are unmounted");
			console.log("teardown disposes sessions and routes OK");
		}
		//#endregion

		console.log("\nALL AGENT-BACKED STUB TESTS PASSED");
	});
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
