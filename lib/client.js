/**
 * GENERATED FILE — do not edit.
 * Built from client/model.js, client/ui.js, client/entry.js, and
 * client/styles.css by `node client/build.mjs`. Edit the sources and rebuild.
 */
window.__ModuleLoader__.load({
	id: "dsh-openai-api",
	factory: (require) => {
		const STYLE_ID = "dsh-openai-api-styles";
		const CSS = "/*\n * Mirrors the harness's own collapsible row (the conversation To-do panel):\n * a rounded card holding a full-width header button — lead icon, title,\n * muted progress, chevron — with the detail revealed underneath.\n */\n\n.dsh-openai-entry {\n\tbox-sizing: border-box;\n\twidth: 100%;\n\tborder-radius: var(--dsw-radius-lg, 12px);\n\tbackground: 0 0;\n\tcolor: var(--dsw-alias-label-primary, #24272d);\n}\n\n.dsh-openai-entry * {\n\tbox-sizing: border-box;\n}\n\n.dsh-openai-body {\n\tdisplay: flex;\n\t/* The row lives at the sidebar foot, so the reveal grows upwards: the DOM\n\t   keeps the toggle first (tab and screen-reader order) while the detail is\n\t   painted above it. */\n\tflex-direction: column-reverse;\n\tgap: 8px;\n\tpadding: 6px 12px;\n\tjustify-content: flex-start;\n}\n\n.dsh-openai-header {\n\tdisplay: flex;\n\talign-items: center;\n\tgap: 10px;\n\twidth: 100%;\n\tpadding: 0;\n\tborder: 0;\n\tbackground: 0 0;\n\tcolor: inherit;\n\tfont: inherit;\n\ttext-align: left;\n\tcursor: pointer;\n}\n\n.dsh-openai-lead,\n.dsh-openai-chevron {\n\tflex: none;\n\tdisplay: grid;\n\tplace-items: center;\n\tcolor: var(--dsw-alias-label-tertiary, #69717d);\n}\n\n.dsh-openai-icon {\n\tdisplay: block;\n}\n\n.dsh-openai-title {\n\tflex: none;\n\tfont-size: 13px;\n\tfont-weight: 500;\n\tline-height: 24px;\n\tcolor: var(--dsw-alias-label-primary, #24272d);\n}\n\n.dsh-openai-progress {\n\tflex: auto;\n\tmin-width: 0;\n\toverflow: hidden;\n\tfont-size: 13px;\n\tfont-weight: 400;\n\tline-height: 20px;\n\tcolor: var(--dsw-alias-label-tertiary, #69717d);\n\ttext-overflow: ellipsis;\n\twhite-space: nowrap;\n\tfont-variant-numeric: tabular-nums;\n}\n\n.dsh-openai-header:focus-visible,\n.dsh-openai-detail button:focus-visible,\n.dsh-openai-detail input:focus-visible,\n.dsh-openai-detail summary:focus-visible {\n\toutline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary, #4b6bda));\n\toutline-offset: 2px;\n}\n\n.dsh-openai-detail {\n\tdisplay: flex;\n\tflex-direction: column;\n\tgap: 8px;\n\tmin-width: 0;\n\t/* The list above gives up its height to the reveal, so this cap only keeps\n\t   a very tall detail from swallowing the whole column. */\n\tmax-height: min(52vh, 340px);\n\toverflow-y: auto;\n\toverscroll-behavior: contain;\n\t--dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);\n\t--dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);\n}\n\n.dsh-openai-checkrow {\n\tdisplay: flex;\n\talign-items: center;\n\tgap: 8px;\n\tjustify-content: space-between;\n}\n\n.dsh-openai-checkrow .dsh-openai-status {\n\tflex: 1;\n\tmin-width: 0;\n}\n\n.dsh-openai-label {\n\tfont-size: 12px;\n\tline-height: 18px;\n\tcolor: var(--dsw-alias-label-tertiary, #69717d);\n}\n\n.dsh-openai-address-row {\n\tdisplay: flex;\n\talign-items: stretch;\n\tgap: 6px;\n}\n\n.dsh-openai-address {\n\tflex: 1;\n\tmin-width: 0;\n\twidth: 100%;\n\tpadding: 6px 8px;\n\tborder: 1px solid var(--dsw-alias-border-l2, #e3e5ea);\n\tborder-radius: var(--dsw-radius-md, 8px);\n\tbackground: var(--dsw-alias-bg-module-platform, #f0f1f4);\n\tcolor: inherit;\n\tfont: 12px/18px ui-monospace, SFMono-Regular, Consolas, monospace;\n\ttext-overflow: ellipsis;\n}\n\n.dsh-openai-button {\n\tdisplay: inline-flex;\n\talign-items: center;\n\tjustify-content: center;\n\tflex: none;\n\tmin-height: 30px;\n\tpadding: 5px 10px;\n\tborder: 1px solid var(--dsw-alias-border-l2, #e3e5ea);\n\tborder-radius: var(--dsw-radius-md, 8px);\n\tbackground: var(--dsw-alias-bg-module-platform, #f0f1f4);\n\tcolor: inherit;\n\tfont: inherit;\n\tfont-size: 12px;\n\tline-height: 18px;\n\twhite-space: nowrap;\n\tcursor: pointer;\n\ttransition: background-color 140ms ease, transform 120ms ease-out;\n}\n\n.dsh-openai-button:disabled {\n\tcursor: default;\n\topacity: 0.55;\n}\n\n.dsh-openai-button:not(:disabled):active {\n\ttransform: scale(0.97);\n}\n\n.dsh-openai-meta {\n\tdisplay: flex;\n\tflex-wrap: wrap;\n\tgap: 4px 14px;\n\tmargin: 0;\n\tfont-size: 12px;\n\tline-height: 18px;\n\tcolor: var(--dsw-alias-label-secondary, #505966);\n}\n\n.dsh-openai-meta > div {\n\tdisplay: flex;\n\tgap: 5px;\n\tmin-width: 0;\n}\n\n.dsh-openai-meta dt,\n.dsh-openai-meta dd {\n\tmargin: 0;\n}\n\n.dsh-openai-meta dd {\n\tcolor: var(--dsw-alias-label-primary, #24272d);\n\toverflow-wrap: anywhere;\n}\n\n.dsh-openai-note {\n\tmargin: 0;\n\tfont-size: 12px;\n\tline-height: 18px;\n\tcolor: var(--dsw-alias-label-tertiary, #69717d);\n\toverflow-wrap: anywhere;\n}\n\n.dsh-openai-status {\n\tdisplay: flex;\n\talign-items: center;\n\tgap: 7px;\n\tmin-height: 18px;\n\tfont-size: 12px;\n\tline-height: 18px;\n\tcolor: var(--dsw-alias-label-secondary, #505966);\n}\n\n.dsh-openai-dot {\n\tflex: none;\n\twidth: 6px;\n\theight: 6px;\n\tborder-radius: 50%;\n\tbackground: var(--dsw-alias-label-tertiary, #69717d);\n}\n\n/* Reachable is blue, everything else is red; both are theme tokens, so they\n   hold up in either theme instead of being picked per appearance. */\n.dsh-openai-status[data-tone=\"ok\"] .dsh-openai-dot,\n.dsh-openai-status[data-tone=\"auth\"] .dsh-openai-dot {\n\tbackground: var(--dsw-alias-state-business-primary, var(--dsw-static-blue-500, #3b82f6));\n}\n\n.dsh-openai-status[data-tone=\"error\"] .dsh-openai-dot {\n\tbackground: var(--dsw-alias-state-error-primary, #cf4c4c);\n}\n\n.dsh-openai-details {\n\tfont-size: 12px;\n\tline-height: 18px;\n}\n\n.dsh-openai-details summary {\n\tcursor: pointer;\n\tuser-select: none;\n\tcolor: var(--dsw-alias-label-tertiary, #69717d);\n}\n\n.dsh-openai-code {\n\tmargin: 8px 0;\n\tpadding: 8px;\n\tborder-radius: var(--dsw-radius-md, 8px);\n\tbackground: var(--dsw-alias-bg-module-platform, #f0f1f4);\n\tfont: 11px/17px ui-monospace, SFMono-Regular, Consolas, monospace;\n\twhite-space: pre-wrap;\n\toverflow-wrap: anywhere;\n}\n\n.dsh-openai-endpoints {\n\tdisplay: grid;\n\tgap: 6px;\n\tmargin: 8px 0 0;\n}\n\n.dsh-openai-endpoints dt {\n\tcolor: var(--dsw-alias-label-tertiary, #69717d);\n}\n\n.dsh-openai-endpoints dd {\n\tmargin: 2px 0 0;\n\tfont: 11px/16px ui-monospace, SFMono-Regular, Consolas, monospace;\n\toverflow-wrap: anywhere;\n\tuser-select: text;\n}\n\n/* The 56px rail has no room for an inline reveal, so its detail floats beside\n   the rail — the placement the harness's own footer panel uses there. */\n.dsh-openai-entry[data-wide=\"false\"] {\n\twidth: 36px;\n\theight: 36px;\n\tborder-radius: 50%;\n\toverflow: visible;\n}\n\n.dsh-openai-entry[data-wide=\"false\"] .dsh-openai-body {\n\tpadding: 0;\n}\n\n.dsh-openai-entry[data-wide=\"false\"] .dsh-openai-header {\n\tjustify-content: center;\n\tgap: 0;\n\twidth: 36px;\n\theight: 36px;\n\tborder-radius: 50%;\n}\n\n.dsh-openai-entry[data-wide=\"false\"] .dsh-openai-title,\n.dsh-openai-entry[data-wide=\"false\"] .dsh-openai-progress,\n.dsh-openai-entry[data-wide=\"false\"] .dsh-openai-chevron {\n\tdisplay: none;\n}\n\n.dsh-openai-entry[data-wide=\"false\"] .dsh-openai-detail {\n\tposition: fixed;\n\tleft: 64px;\n\tbottom: 12px;\n\tz-index: 60;\n\twidth: min(320px, calc(100vw - 80px));\n\tmax-height: 60vh;\n\tpadding: 12px;\n\tborder-radius: var(--dsw-radius-lg, 12px);\n\tbackground: var(--dsw-specific-menu, var(--dsw-alias-bg-base, #fff));\n\tbackdrop-filter: var(--dsw-menu-backdrop-filter, none);\n\tbox-shadow: var(--dsw-elevation-prominent, 0 8px 32px #18233b1a);\n\toverflow-y: auto;\n}\n\n@media (hover: hover) {\n\t/* The same fill the settings and account rows use when pointed at. */\n\t.dsh-openai-entry:hover {\n\t\tbackground: var(--dsw-alias-interactive-bg-hover, #eceef2);\n\t}\n\n\t.dsh-openai-button:not(:disabled):hover {\n\t\tbackground: var(--dsw-alias-interactive-bg-hover, #eceef2);\n\t}\n}\n\n/* Kept while the row is open, so the block stays visibly selected. */\n.dsh-openai-entry[data-open=\"true\"] {\n\tbackground: var(--dsw-alias-interactive-bg-hover, #eceef2);\n}\n\n@media (prefers-reduced-motion: reduce) {\n\t.dsh-openai-button {\n\t\ttransition: none;\n\t}\n\n\t.dsh-openai-button:not(:disabled):active {\n\t\ttransform: none;\n\t}\n}";
		{
			const existing = document.getElementById(STYLE_ID);
			const style = existing !== null && existing !== void 0 ? existing : document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = CSS;
			if (existing === null) document.head.appendChild(style);
		}

		//#region client/model.js
		const model = (() => {
/**
 * Pure, browser-safe helpers behind the sidebar API panel.
 *
 * No host secrets live here: every field arrives from the allowlisted
 * `/api/openai-api/status` descriptor, and nothing in this file reads a key.
 */

/** Route the host Connection service owns for the descriptor. */
const STATUS_PATH = "/api/openai-api/status";

/**
 * Resolve the descriptor route against the page itself.
 *
 * Root-absolute on purpose: the host registers `/api` at the server root, so a
 * page served under a mount path must not inherit that mount here. Resolving
 * against the document URL also keeps desktop (`dsh-app:`) pages on their own
 * carrier, where the shell forwarder attaches the private credential.
 */
function statusUrlFor(documentUrl) {
	return new URL(STATUS_PATH, documentUrl).href;
}

/** Accept exactly the descriptor shape this client understands. */
function parseStatus(value) {
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

/** Default port text for an origin whose URL omits it. */
function effectivePort(url) {
	if (url.port !== "") return url.port;
	return url.protocol === "https:" ? "443" : "80";
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
function resolveAddresses(status, documentUrl) {
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
		port: base === null ? status.listenPort : Number(effectivePort(base)),
		offCarrier: base !== null && !isWebPage,
		// Pass the descriptor facts the panel displays straight through: without
		// them the auth and model rows have nothing to show.
		model: status.model,
		authRequired: status.authRequired,
		listenerOrigin: status.listenerOrigin,
	};
}

/** GET one URL as JSON, honouring an outer abort signal and a hard timeout. */
async function requestJson(fetcher, url, outerSignal, timeoutMs = 8000) {
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
function probeResult(result) {
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
function curlExample(baseUrl, authRequired) {
	const quote = (value) => `'${value.split("'").join(`'\\''`)}'`;
	const head = `curl ${quote(`${baseUrl}/models`)}`;
	return authRequired ? `${head} \\\n  -H 'Authorization: Bearer YOUR_API_KEY'` : head;
}
			return { STATUS_PATH, statusUrlFor, parseStatus, resolveAddresses, requestJson, probeResult, curlExample };
		})();
		//#endregion

		//#region client/ui.js
/**
 * The sidebar API row: a collapsible card that matches the harness's own
 * To-do row — lead icon, title, muted progress, chevron, detail underneath.
 *
 * Pure presentation over `client/model.js`. It receives React from the module
 * loader's shared seed table and never touches a credential: the only copyable
 * text is the address a caller pastes into a client.
 */

/** Probe status text and its visual tone. */
const PROBE_TEXT = {
	checking: ["正在检测…", "neutral"],
	ok: ["接口可用", "ok"],
	auth: ["接口可达 · 需要 API Key", "auth"],
	forbidden: ["来源被拒绝", "error"],
	missing: ["未找到接口路径", "error"],
	unexpected: ["响应不符合预期", "error"],
	error: ["无法连接", "error"],
};

/** Turn a transport failure into something a reader can act on. */
function reasonText(message) {
	const text = typeof message === "string" && message !== "" ? message : "未知错误";
	if (text.includes("401")) return "宿主要求已认证的页面（401）";
	if (text.includes("403")) return "宿主拒绝了该来源（403）";
	if (text.includes("404")) return "宿主未提供状态接口（404）";
	if (/abort|timeout/i.test(text)) return "请求超时";
	if (text === "invalid_status") return "宿主返回的状态格式无法识别";
	return text;
}

/**
 * Build the panel components.
 * @param React - shared React instance from the loader seed table.
 * @param model - helpers from `./model.js`.
 * @returns the registered slot components.
 */
function createUi(React, model) {
	const h = React.createElement;
	const { useCallback, useEffect, useRef, useState } = React;

	function ApiIcon({ size }) {
		return h("svg", { className: "dsh-openai-icon", width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
			h("path", { d: "M6 1.9v3.3M10 1.9v3.3", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" }),
			h("path", { d: "M4.35 5.2h7.3v2.45a3.65 3.65 0 0 1-7.3 0V5.2Z", stroke: "currentColor", strokeWidth: 1.4, strokeLinejoin: "round" }),
			h("path", { d: "M8 11.3v2.8", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" }),
		);
	}

	/** Collapsed points up towards where the detail appears; expanded points down. */
	function Chevron({ expanded }) {
		const path = expanded ? "m3.5 6 4.5 4.5L12.5 6" : "m3.5 10 4.5-4.5 4.5 4.5";
		return h("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
			h("path", { d: path, stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" }),
		);
	}

	function Row({ term, children }) {
		return h("div", null, h("dt", null, term), h("dd", null, children));
	}

	/**
	 * Keep one bad render from retiring the whole sidebar cell.
	 *
	 * A slot occupant that throws is abdicated by the host's own boundary, which
	 * removes the entry until it reloads. Catching here leaves the row alive and
	 * puts the reason on screen, where it can be reported.
	 */
	class Guard extends React.Component {
		constructor(props) {
			super(props);
			this.state = { error: null };
		}

		static getDerivedStateFromError(error) {
			return { error };
		}

		componentDidCatch(error) {
			console.error("openai-api: panel render failed:", error);
		}

		render() {
			if (this.state.error === null) return this.props.children;
			const message = this.state.error instanceof Error ? this.state.error.message : String(this.state.error);
			return h("div", { className: "dsh-openai-entry", "data-wide": this.props.wide !== false },
				h("div", { className: "dsh-openai-body" },
					h("p", { className: "dsh-openai-note", role: "alert" }, `接入面板出错：${message}`),
				),
			);
		}
	}

	/** The sidebar footer action, kept behind the guard above. */
	function Entry(props) {
		return h(Guard, { wide: props.wide }, h(EntryInner, props));
	}

	function EntryInner({ wide }) {
		const expanded = wide !== false;
		const [open, setOpen] = useState(false);
		const [load, setLoad] = useState({ phase: "idle" });
		const [probe, setProbe] = useState("idle");
		const [copied, setCopied] = useState("");
		const [attempt, setAttempt] = useState(0);
		const rootRef = useRef(null);
		const inputRef = useRef(null);
		const copyTimer = useRef(0);

		// Read the descriptor on every open, but keep what the row already shows:
		// the refresh replaces values once the answer lands, so reopening never
		// flashes an empty state and a host that moved to another port is picked
		// up without a page reload. A failed refresh leaves the old values alone.
		useEffect(() => {
			if (!open) return undefined;
			const controller = new AbortController();
			const hasValues = load.phase === "ready";
			if (!hasValues) setLoad({ phase: "loading" });
			setProbe("checking");
			const statusUrl = model.statusUrlFor(window.location.href);
			void (async () => {
				try {
					// requestJson resolves to `{status, body}` — not a Response.
					const response = await model.requestJson(window.fetch.bind(window), statusUrl, controller.signal);
					if (controller.signal.aborted) return;
					if (response.status !== 200) throw new Error(`status ${response.status}`);
					const descriptor = model.parseStatus(response.body);
					const addresses = model.resolveAddresses(descriptor, window.location.href);
					setLoad({ phase: "ready", ...addresses });
					// Expanding is the request to know whether the surface answers.
					await runProbe(addresses.probeUrl, controller.signal);
				} catch (error) {
					if (controller.signal.aborted || hasValues) return;
					setLoad({ phase: "error", message: error instanceof Error ? error.message : String(error), statusUrl });
				}
			})();
			return () => controller.abort();
		}, [open, attempt]);

		const close = useCallback(() => setOpen(false), []);

		useEffect(() => {
			if (!open) return undefined;
			const onKeyDown = (event) => {
				// Another surface may own this Escape (a dialog above us).
				if (event.key === "Escape" && !event.defaultPrevented) close();
			};
			const onPointerDown = (event) => {
				if (rootRef.current?.contains(event.target) === true) return;
				// The rail's detail floats, so it sits outside the row's own box.
				if (event.target?.closest?.(".dsh-openai-detail") != null) return;
				close();
			};
			document.addEventListener("keydown", onKeyDown);
			document.addEventListener("pointerdown", onPointerDown, true);
			return () => {
				document.removeEventListener("keydown", onKeyDown);
				document.removeEventListener("pointerdown", onPointerDown, true);
			};
		}, [open, close]);

		useEffect(() => () => clearTimeout(copyTimer.current), []);

		/** Run one `/models` probe; shared by the auto-check and the button. */
		const runProbe = async (url, signal) => {
			setProbe("checking");
			try {
				const result = await model.requestJson(window.fetch.bind(window), url, signal);
				setProbe(model.probeResult(result));
			} catch {
				setProbe("error");
			}
		};

		const copy = async () => {
			const text = load.baseUrl;
			if (typeof text !== "string") return;
			let done = false;
			try {
				if (navigator.clipboard?.writeText !== undefined) {
					await navigator.clipboard.writeText(text);
					done = true;
				}
			} catch {
				done = false;
			}
			if (!done) {
				inputRef.current?.select();
				done = document.execCommand?.("copy") === true;
			}
			setCopied(done ? "done" : "manual");
			clearTimeout(copyTimer.current);
			copyTimer.current = setTimeout(() => setCopied(""), 1600);
		};

		// Opening always probes, so the first frame already reads "checking":
		// the status text then never changes just because an effect ran.
		const shownProbe = probe === "idle" && open ? "checking" : probe;
		const [probeText, probeTone] = PROBE_TEXT[shownProbe] ?? ["", "neutral"];
		// A healthy surface needs no button: only an unanswered or refused one does.
		const showRetry = shownProbe !== "idle" && shownProbe !== "checking" && shownProbe !== "ok" && shownProbe !== "auth";
		const ready = load.phase === "ready";
		// The header carries the one fact worth showing while collapsed.
		const progress = ready
			? String(load.port ?? load.listenPort ?? "")
			: load.phase === "error"
				? "读取失败"
				: open
					? "读取中…"
					: "";

		return h("section", { className: "dsh-openai-entry", "data-wide": expanded, "data-open": open, ref: rootRef, "aria-label": "API 接入信息" },
			h("div", { className: "dsh-openai-body" },
				h("button", {
					type: "button",
					className: "dsh-openai-header",
					"aria-expanded": open,
					"aria-controls": open ? "dsh-openai-detail" : undefined,
					"aria-label": expanded ? undefined : `API 接入信息${ready ? ` · ${load.baseUrl}` : ""}`,
					onClick: () => setOpen((value) => !value),
				},
					h("span", { className: "dsh-openai-lead", "aria-hidden": true }, h(ApiIcon, { size: 16 })),
					h("span", { className: "dsh-openai-title" }, "API"),
					h("span", { className: "dsh-openai-progress" }, progress === "" ? null : progress),
					h("span", { className: "dsh-openai-chevron", "aria-hidden": true }, h(Chevron, { expanded: open })),
				),

				open && h("div", { id: "dsh-openai-detail", className: "dsh-openai-detail" },
					// One stable skeleton from the first frame: the values fill in
					// place, so expanding never reflows or flashes.
					load.phase === "error"
						? h(React.Fragment, null,
							h("p", { className: "dsh-openai-note" }, `无法读取接入信息：${reasonText(load.message)}`),
							h("p", { className: "dsh-openai-note" }, load.statusUrl ?? ""),
							h("button", { type: "button", className: "dsh-openai-button", onClick: () => setAttempt((value) => value + 1) }, "重试"),
						)
						: h(React.Fragment, null,
							h("label", { className: "dsh-openai-label", htmlFor: "dsh-openai-base" }, "接入地址 · Base URL"),
							h("div", { className: "dsh-openai-address-row" },
								h("input", {
									id: "dsh-openai-base",
									ref: inputRef,
									className: "dsh-openai-address",
									readOnly: true,
									value: load.baseUrl ?? "",
									placeholder: ready ? "" : "读取中…",
									spellCheck: false,
									onFocus: (event) => event.target.select(),
								}),
								h("button", { type: "button", className: "dsh-openai-button", disabled: !ready, onClick: () => void copy() }, copied === "done" ? "已复制" : copied === "manual" ? "请手动复制" : "复制"),
							),

							h("dl", { className: "dsh-openai-meta" },
								h(Row, { term: "鉴权" }, ready ? (load.authRequired ? "需要 API Key" : "免密钥 · 仅本机") : "—"),
								h(Row, { term: "模型 id" }, ready ? (load.model ?? "—") : "—"),
							),

							ready && load.offCarrier && load.listenerOrigin !== null && h("p", { className: "dsh-openai-note" }, "这是本机监听地址；桌面端页面经由应用通道访问，检测仍走当前页面。"),

							h("div", { className: "dsh-openai-checkrow" },
								h("div", { className: "dsh-openai-status", "data-tone": probeTone, role: "status", "aria-live": "polite" },
									h("span", { className: "dsh-openai-dot", "aria-hidden": true }),
									h("span", null, probeText),
								),
								showRetry && h("button", { type: "button", className: "dsh-openai-button", onClick: () => void runProbe(load.probeUrl) }, "检测"),
							),

							h("details", { className: "dsh-openai-details" },
								h("summary", null, "接入示例"),
								ready && h("div", null,
									h("pre", { className: "dsh-openai-code" }, model.curlExample(load.baseUrl ?? "", load.authRequired === true)),
									h("dl", { className: "dsh-openai-endpoints" },
										h(Row, { term: "Chat Completions" }, `POST ${load.baseUrl}/chat/completions`),
										h(Row, { term: "Responses" }, `POST ${load.baseUrl}/responses`),
										h(Row, { term: "模型列表" }, `GET ${load.baseUrl}/models`),
									),
									h("p", { className: "dsh-openai-note" }, "可选请求头：X-Agent-Preset 选择会话预设，X-Session-Id 隔离角色会话。检测只访问模型列表，不触发模型调用。"),
								),
							),
						),
				),
			),
		);
	}

	return { Entry };
}
		//#endregion

		//#region client/entry.js
/**
 * Plugin body for the browser half.
 *
 * The build step concatenates `model.js`, `ui.js`, and this file into the
 * factory of `lib/client.js`, so these module-scope bindings (`React`, `model`)
 * are already defined there; the import lines below only keep this file valid
 * standalone ESM.
 */
const React = require("react");

/** Stable Cordis plugin name for the browser half. */
const name = "openai-api-ui";

/** Only the slot registry is required; React comes from the shared seed table. */
const inject = ["slots"];

/**
 * Register the sidebar footer action.
 *
 * The sidebar owns the row geometry and passes `wide` (false in the 56px rail),
 * so the entry only decides what the row and its detail look like.
 *
 * @param ctx - Client root context.
 */
function apply(ctx) {
	const { Entry } = createUi(React, model);
	ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
		name: "sidebar.footer.action",
		id: "openai-api",
		order: 50,
		label: "API",
	}, Entry));
}
		//#endregion

		return { name, inject, apply };
	},
});
