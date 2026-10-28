/**
 * Pure, browser-safe helpers behind the sidebar API panel.
 *
 * No host secrets live here: every field arrives from the allowlisted
 * `/api/openai-api/status` descriptor, and nothing in this file reads a key.
 */

/** Route the host Connection service owns for the descriptor. */
export const STATUS_PATH = "/api/openai-api/status";

/**
 * Resolve the descriptor route against the page itself.
 *
 * Root-absolute on purpose: the host registers `/api` at the server root, so a
 * page served under a mount path must not inherit that mount here. Resolving
 * against the document URL also keeps desktop (`dsh-app:`) pages on their own
 * carrier, where the shell forwarder attaches the private credential.
 */
export function statusUrlFor(documentUrl) {
	return new URL(STATUS_PATH, documentUrl).href;
}

/** Accept exactly the descriptor shape this client understands. */
export function parseStatus(value) {
	if (value === null || typeof value !== "object") throw new Error("invalid_status");
	if (value.schemaVersion !== 1) throw new Error("invalid_status");
	const pathPrefix = value.pathPrefix;
	if (typeof pathPrefix !== "string" || pathPrefix === "" || !pathPrefix.startsWith("/") || pathPrefix.startsWith("//")) throw new Error("invalid_status");
	if (/[?#\\\s]/.test(pathPrefix) || pathPrefix.split("/").some((part) => part === "." || part === "..")) throw new Error("invalid_status");
	if (typeof value.model !== "string" || value.model === "") throw new Error("invalid_status");
	if (typeof value.authRequired !== "boolean") throw new Error("invalid_status");
	let listenerOrigin = null;
	if (typeof value.listenerOrigin === "string" && value.listenerOrigin !== "") {
		const url = new URL(value.listenerOrigin);
		if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid_status");
		if (url.pathname !== "/" || url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") throw new Error("invalid_status");
		listenerOrigin = url.origin;
	}
	const port = value.listenPort;
	return {
		pathPrefix: pathPrefix.replace(/\/+$/, "") || "/",
		model: value.model,
		authRequired: value.authRequired,
		listenerOrigin,
		listenPort: Number.isInteger(port) && port > 0 && port <= 65535 ? port : null,
	};
}

/**
 * Derive the address a caller pastes into a client, the address this page
 * probes, and the loopback address to compare against.
 *
 * The plugin registers its routes on the host web server root, so the API
 * prefix is root-absolute and never inherits the page's mount path. Probes stay
 * on the page's own carrier: on desktop the `dsh-app` forwarder attaches the
 * shell's private credential, which a direct fetch of `listenerOrigin` lacks.
 */
export function resolveAddresses(status, documentUrl) {
	const page = new URL(documentUrl);
	const isWebPage = page.protocol === "http:" || page.protocol === "https:";
	const displayOrigin = isWebPage ? page.origin : status.listenerOrigin;
	const base = displayOrigin === null ? null : new URL(status.pathPrefix, displayOrigin);
	// Probing uses the document as its base rather than an origin string: a
	// `dsh-app:` page has an opaque origin, but its own URL still resolves a
	// root-absolute path onto the carrier that injects the shell credential.
	const probeUrl = new URL(`${status.pathPrefix}/models`, documentUrl).href;
	return {
		baseUrl: base === null ? null : base.href.replace(/\/+$/, ""),
		probeUrl,
		port: base === null ? status.listenPort : Number(base.port || (base.protocol === "https:" ? 443 : 80)),
		offCarrier: base !== null && !isWebPage,
		// Pass the descriptor facts the panel displays straight through: without
		// them the auth and model rows have nothing to show.
		model: status.model,
		authRequired: status.authRequired,
		listenerOrigin: status.listenerOrigin,
	};
}

/** GET one URL as JSON, honouring an outer abort signal and a hard timeout. */
export async function requestJson(fetcher, url, outerSignal, timeoutMs = 8000) {
	const controller = new AbortController();
	const abort = () => controller.abort();
	if (outerSignal?.aborted === true) abort();
	else outerSignal?.addEventListener("abort", abort, { once: true });
	const timer = setTimeout(abort, timeoutMs);
	try {
		const response = await fetcher(url, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal });
		let body = null;
		if (response.ok && (response.headers.get("content-type") ?? "").includes("application/json")) {
			try {
				body = await response.json();
			} catch {
				body = null;
			}
		}
		return { status: response.status, body };
	} finally {
		clearTimeout(timer);
		outerSignal?.removeEventListener("abort", abort);
	}
}

/**
 * Classify a `/models` probe. `auth` is a healthy surface: the route answered,
 * it just wants a key — never report that as a broken plugin.
 */
export function probeResult(result) {
	if (result === null || typeof result !== "object" || !Number.isInteger(result.status)) return "unexpected";
	if (result.status === 401) return "auth";
	if (result.status === 403) return "forbidden";
	if (result.status === 404) return "missing";
	if (result.status === 200) {
		const body = result.body;
		const ok = body !== null && typeof body === "object" && body.object === "list" && Array.isArray(body.data) && body.data.every((model) => typeof model?.id === "string");
		return ok ? "ok" : "unexpected";
	}
	return "unexpected";
}

/** The exact copy line shown in the example block. */
export function curlExample(baseUrl, authRequired) {
	const quote = (value) => `'${value.split("'").join(`'\\''`)}'`;
	const head = `curl ${quote(`${baseUrl}/models`)}`;
	return authRequired ? `${head} \\\n  -H 'Authorization: Bearer YOUR_API_KEY'` : head;
}
