/**
 * Contract tests for the generated browser bundle.
 *
 * The harness loads `lib/client.js` as a classic script that only registers a
 * lazy-CJS factory, so these tests run the artifact against a stub loader, a
 * stub document, and a small stateful React stand-in. They prove the
 * registration shape, the slot wiring, and the states the panel actually
 * reaches — not layout or paint, which need a real browser.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

const DESCRIPTOR = { schemaVersion: 1, pathPrefix: "/v1", model: "default", authRequired: false, listenerOrigin: "http://127.0.0.1:57781", listenPort: 57781 };

/** Resolve function and class components the way React would. */
function renderTree(node) {
	if (node === null || typeof node !== "object") return node;
	if (typeof node.type === "function") {
		const isClass = typeof node.type.prototype?.render === "function";
		return renderTree(isClass ? new node.type(node.props).render() : node.type(node.props));
	}
	return { ...node, children: (node.children ?? []).map(renderTree) };
}

function findNode(node, matches) {
	if (node === null || typeof node !== "object") return null;
	if (matches(node)) return node;
	for (const child of node.children ?? []) {
		const found = findNode(child, matches);
		if (found) return found;
	}
	return null;
}
const findByClass = (node, name) => findNode(node, (item) => item.props?.className?.split(/\s+/).includes(name));
const findTag = (node, tag) => findNode(node, (item) => item.type === tag);

/** Collect every string in a rendered tree. */
function textOf(node) {
	if (typeof node === "string") return [node];
	if (node === null || typeof node !== "object") return [];
	return (node.children ?? []).flatMap(textOf);
}

/**
 * A stateful, effect-running React stand-in.
 *
 * Hooks keep their slots across renders and `settle()` runs the effects once, so
 * a test can observe what the panel becomes after its descriptor read resolves
 * — the behaviour that regressed twice during development.
 *
 * @param options - `open` makes the panel start open; `status`/`body` shape the
 *   stubbed status-route response.
 */
function createHarness(options = {}) {
	const hooks = [];
	const effects = [];
	const ranEffects = new Set();
	const cleanups = [];
	let cursor = 0;
	let component = null;
	let registration = null;

	class Component {
		constructor(props) {
			this.props = props ?? {};
			this.state = {};
		}
	}

	const React = {
		Component,
		createElement: (type, props, ...children) => ({
			type,
			props: { ...(props ?? {}), children: children.length === 0 ? undefined : (children.length === 1 ? children[0] : children) },
			children,
		}),
		useState(initial) {
			const slot = cursor++;
			if (hooks[slot] === undefined) {
				hooks[slot] = {
					value: slot === 0 && options.open === true ? true : (typeof initial === "function" ? initial() : initial),
					set: () => {},
				};
				hooks[slot].set = (next) => {
					hooks[slot].value = typeof next === "function" ? next(hooks[slot].value) : next;
				};
			}
			return [hooks[slot].value, hooks[slot].set];
		},
		useRef(initial) {
			const slot = cursor++;
			hooks[slot] ??= { value: { current: initial } };
			return hooks[slot].value;
		},
		useEffect(effect) {
			effects[cursor++] = effect;
		},
	};

	const styles = [];
	const document = {
		getElementById: () => null,
		createElement: () => ({ id: "", textContent: "" }),
		head: { appendChild: (element) => styles.push(element) },
		addEventListener: () => {},
		removeEventListener: () => {},
	};
	const calls = [];
	const window = {
		__ModuleLoader__: { load: (value) => { registration = value; } },
		location: { href: "http://127.0.0.1:57781/", origin: "http://127.0.0.1:57781" },
		fetch: async (url, init) => {
			calls.push(String(url));
			if (options.fetch) return options.fetch(url, init);
			const models = String(url).endsWith("/models");
			const status = models ? (options.modelsStatus ?? 200) : (options.status ?? 200);
			const ok = status === 200;
			return {
				ok,
				status,
				headers: { get: () => "application/json" },
				json: async () => (models ? { object: "list", data: [{ id: "default" }] } : (options.body ?? DESCRIPTOR)),
			};
		},
	};

	// eslint-disable-next-line no-new-func -- the artifact is a classic script, by contract.
	new Function("window", "document", SOURCE)(window, document);

	const harness = {
		registration,
		styles,
		window,
		calls,
		injectedInto: null,
		options: null,
		component: () => component,
		render(props = { wide: true }) {
			cursor = 0;
			return renderTree(component(props));
		},
		close() {
			for (const dispose of cleanups.splice(0)) dispose?.();
			ranEffects.clear();
			hooks[0].set(false);
			return this.render();
		},
		async reopen(props = { wide: true }) {
			this.close();
			hooks[0].set(true);
			return this.settle(props);
		},
		/** Run each effect once, let its async work land, then re-render. */
		async settle(props = { wide: true }) {
			this.render(props);
			for (let slot = 0; slot < effects.length; slot++) {
				if (ranEffects.has(slot) || typeof effects[slot] !== "function") continue;
				ranEffects.add(slot);
				cleanups.push(effects[slot]());
			}
			await new Promise((resolve) => setTimeout(resolve, 30));
			return this.render(props);
		},
	};

	const mod = registration.factory((id) => {
		assert.equal(id, "react", "React is the only shared module the bundle needs");
		return React;
	});
	mod.apply({
		slots: {
			inject: (name, callback) => { harness.injectedInto = name; return callback(); },
			register: (slotOptions, value) => { component = value; harness.options = slotOptions; return () => {}; },
		},
	});
	return harness;
}

test("the artifact is a classic script that only registers a factory", () => {
	assert.equal(/^import\b/m.test(SOURCE), false);
	assert.equal(/^export\b/m.test(SOURCE), false);
	const styles = [];
	let registration = null;
	const document = { getElementById: () => null, createElement: () => ({ id: "", textContent: "" }), head: { appendChild: (element) => styles.push(element) } };
	const window = { __ModuleLoader__: { load: (value) => { registration = value; } } };
	// eslint-disable-next-line no-new-func -- the artifact is a classic script, by contract.
	new Function("window", "document", SOURCE)(window, document);
	assert.notEqual(registration, null);
	assert.equal(registration.id, "dsh-openai-api");
	assert.equal(typeof registration.factory, "function");
	assert.equal(styles.length, 0, "styles must be injected at materialization, not at registration");
});

test("the factory injects the stylesheet once and returns the plugin body", () => {
	const harness = createHarness();
	assert.equal(harness.styles.length, 1);
	assert.equal(harness.styles[0].id, "dsh-openai-api-styles");
	assert.match(harness.styles[0].textContent, /\.dsh-openai-header\s*\{/);
	// The rail hides the text columns; that is CSS, not a different tree.
	assert.match(harness.styles[0].textContent, /\[data-wide="false"\][^{]*\.dsh-openai-progress/);
	assert.match(harness.styles[0].textContent, /prefers-reduced-motion/);
});

test("apply registers the sidebar footer action under a stable id", () => {
	const harness = createHarness();
	assert.equal(harness.injectedInto, "sidebar.footer.action");
	assert.equal(harness.options.name, "sidebar.footer.action");
	assert.equal(harness.options.id, "openai-api");
	assert.equal(harness.options.label, "API");
	assert.equal(typeof harness.component(), "function");
});

test("the collapsed row matches the harness's own collapsible row", () => {
	const harness = createHarness();
	const row = harness.render({ wide: true });
	assert.equal(row.type, "section");
	assert.equal(row.props.className, "dsh-openai-entry");
	assert.equal(row.props["data-wide"], true);
	assert.equal(row.props["data-open"], false, "the highlight is driven by the open state");

	const header = findTag(row, "button");
	assert.equal(header.props.className, "dsh-openai-header");
	assert.equal(header.props["aria-expanded"], false);
	const spans = header.children.map((child) => child.props.className);
	assert.deepEqual(spans, ["dsh-openai-lead", "dsh-openai-title", "dsh-openai-progress", "dsh-openai-chevron"]);
	assert.deepEqual(textOf(header), ["API"]);
	// Collapsed by default: nothing is revealed before the row is clicked.
	assert.equal(findTag(row, "input"), null);
	assert.equal(textOf(row).includes("接入地址 · Base URL"), false);
});

test("the rail keeps an icon-only button that still names the address", async () => {
	const harness = createHarness({ open: true });
	const row = harness.render({ wide: false });
	assert.equal(row.props["data-wide"], false);
	const header = findTag(row, "button");
	assert.match(header.props["aria-label"], /^API 接入信息/);

	const settled = await harness.settle({ wide: false });
	assert.match(findTag(settled, "button").props["aria-label"], /http:\/\/127\.0\.0\.1:57781\/v1/);
});

test("expanding reveals the detail inline, not in a floating layer", async () => {
	const harness = createHarness({ open: true });
	const row = harness.render({ wide: true });
	assert.equal(findTag(row, "portal"), null, "the detail belongs to the row, not a portal");
	const header = findTag(row, "button");
	assert.equal(header.props["aria-expanded"], true);
	assert.equal(row.props["data-open"], true);
	// The detail is a child of the row itself, and the whole layout exists from
	// the first frame: only the values fill in, so nothing reflows.
	const detail = findByClass(row, "dsh-openai-detail");
	assert.notEqual(detail, null);
	assert.notEqual(findByClass(row, "dsh-openai-address-row"), null);
	assert.equal(findTag(row, "input").props.placeholder, "读取中…");
	assert.equal(textOf(row).includes("正在检测…"), true);
	// Hover and open share the token the settings and account rows use.
	const css = harness.styles[0].textContent;
	assert.match(css, /@media \(hover: hover\)[\s\S]*?\.dsh-openai-entry:hover \{\s*background: var\(--dsw-alias-interactive-bg-hover/);
	assert.match(css, /\.dsh-openai-entry\[data-open="true"\] \{\s*background: var\(--dsw-alias-interactive-bg-hover/);
	assert.equal(css.includes("#c8cace"), false, "no hand-picked colour: the theme token owns it");
	// Reachable reads blue, a failure reads red — from the theme, not per taste.
	assert.match(css, /\[data-tone="ok"\] \.dsh-openai-dot[\s\S]*?var\(--dsw-alias-state-business-primary/);
	assert.match(css, /\[data-tone="error"\] \.dsh-openai-dot \{\s*background: var\(--dsw-alias-state-error-primary/);
	// The detail is painted above the row it belongs to.
	assert.match(harness.styles[0].textContent, /flex-direction:\s*column-reverse/);
	assert.deepEqual(findByClass(row, "dsh-openai-body").children.map((child) => child.props.className), ["dsh-openai-header", "dsh-openai-detail"]);
	assert.equal(row.props.className, "dsh-openai-entry");

	const settled = await harness.settle();
	assert.equal(textOf(settled).includes("接入地址 · Base URL"), true);
});

test("an open panel settles on the address the status route reports", async () => {
	const harness = createHarness({ open: true });
	const settled = await harness.settle();
	const text = textOf(settled).join("\n");
	assert.equal(text.includes("无法读取接入信息"), false, "a 200 answer must not be reported as a failure");
	assert.match(text, /^API\n57781/, "the collapsed header carries the port");
	assert.match(text, /http:\/\/127\.0\.0\.1:57781\/v1/, "the base URL is the whole point of the panel");
	assert.match(text, /57781/);
	assert.match(text, /免密钥 · 仅本机/);
	assert.equal(findTag(settled, "input").props.value, "http://127.0.0.1:57781/v1");
	assert.equal(text.includes("当前页面与接口不同源"), false, "a same-origin page needs no warning");
	// Expanding checks the surface by itself, and a healthy one offers no button.
	assert.match(text, /接口可用/);
	assert.equal(text.includes("检测连接"), false, "the old label is gone");
	assert.equal(textOf(settled).includes("检测"), false, "a working surface needs no re-check button");
	assert.notEqual(findByClass(settled, "dsh-openai-checkrow"), null, "status and button share one row");
});

test("an open panel explains a refused descriptor read", async () => {
	const harness = createHarness({ open: true, status: 401 });
	const settled = await harness.settle();
	const text = textOf(settled).join("\n");
	assert.match(text, /无法读取接入信息：宿主要求已认证的页面（401）/);
	assert.match(text, /\/api\/openai-api\/status/);
	assert.equal(textOf(settled).includes("重试"), true);
});

test("an unanswered surface keeps a re-check button on the status row", async () => {
	const harness = createHarness({ open: true, modelsStatus: 404 });
	const settled = await harness.settle();
	const text = textOf(settled).join("\n");
	assert.match(text, /未找到接口路径/);
	assert.equal(textOf(settled).includes("检测"), true, "a broken surface offers a retry");
	const row = findByClass(settled, "dsh-openai-checkrow");
	assert.deepEqual(row.children.map((child) => child.props.className), ["dsh-openai-status", "dsh-openai-button"]);
});

test("a key-protected surface counts as healthy and hides the button", async () => {
	const harness = createHarness({ open: true, modelsStatus: 401 });
	const settled = await harness.settle();
	assert.match(textOf(settled).join("\n"), /接口可达 · 需要 API Key/);
	assert.equal(textOf(settled).includes("检测"), false);
});

test("reopening refreshes the descriptor without blanking the address", async () => {
	const harness = createHarness({ open: true });
	await harness.settle();
	assert.deepEqual(harness.calls, ["http://127.0.0.1:57781/api/openai-api/status", "http://127.0.0.1:57781/v1/models"]);

	// Collapse and open again: the descriptor is refreshed (a host may have moved
	// to another port) and the probe re-runs, but the row keeps its values.
	const reopened = await harness.reopen();
	const text = textOf(reopened).join("\n");
	assert.equal(text.includes("读取中…"), false);
	assert.match(text, /http:\/\/127\.0\.0\.1:57781\/v1/);
	assert.deepEqual(harness.calls, [
		"http://127.0.0.1:57781/api/openai-api/status",
		"http://127.0.0.1:57781/v1/models",
		"http://127.0.0.1:57781/api/openai-api/status",
		"http://127.0.0.1:57781/v1/models",
	], "each open re-reads the route and re-probes");
});

test("a failed refresh keeps the last address and offers detection instead of hanging", async () => {
	const options = { open: true };
	const harness = createHarness(options);
	await harness.settle();
	options.status = 503;
	const tree = await harness.reopen();
	assert.equal(findTag(tree, "input").props.value, "http://127.0.0.1:57781/v1");
	assert.equal(textOf(tree).includes("正在检测…"), false);
	assert.equal(textOf(tree).includes("检测"), true);
	harness.close();
});

test("closing aborts a pending probe and ignores its late result", async () => {
	const harness = createHarness({ open: true });
	await harness.settle();
	let finish;
	let signal;
	harness.window.fetch = async (url, init) => {
		if (!url.endsWith("/models")) return { status: 200, ok: true, headers: { get: () => "application/json" }, json: async () => DESCRIPTOR };
		signal = init.signal;
		return new Promise((resolve) => { finish = resolve; });
	};
	await harness.reopen();
	harness.close();
	assert.equal(signal.aborted, true);
	finish({ status: 404, ok: false, headers: { get: () => "application/json" } });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(findByClass(harness.render(), "dsh-openai-detail"), null);
});

test("a malformed descriptor is reported rather than rendered", async () => {
	const harness = createHarness({ open: true, body: { schemaVersion: 9 } });
	const settled = await harness.settle();
	assert.match(textOf(settled).join("\n"), /无法读取接入信息：宿主返回的状态格式无法识别/);
});

test("the committed artifact matches its sources", () => {
	execFileSync(process.execPath, ["client/build.mjs", "--check"], { cwd: ROOT, stdio: "pipe" });
});
