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
export function createUi(React, model) {
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
