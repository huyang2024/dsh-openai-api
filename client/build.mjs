/**
 * Build the browser bundle from the authored sources.
 *
 * The harness serves each client plugin as one classic script holding a
 * lazy-CJS factory (`window.__ModuleLoader__.load`), so the browser half cannot
 * be ESM and cannot require a sibling file at runtime. This step therefore
 * inlines the sources into a single factory, in dependency order, and appends
 * the loader registration.
 *
 * Only the import forms used by `client/*.js` are supported, and the build
 * fails loudly on anything else instead of silently dropping code:
 *   - `import React from "react"`  → `require("react")` (shared seed table)
 *   - `import ... from "./x.js"`   → removed; the bundling order defines them
 *   - top-level `export`           → removed; the factory returns its exports
 *
 * Usage:
 *   node client/build.mjs            write lib/client.js
 *   node client/build.mjs --check    verify the artifact is up to date
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(fileURLToPath(new URL(path, ROOT)), "utf8");

/** The model namespace object the other sources expect, in export order. */
const MODEL_EXPORTS = ["STATUS_PATH", "statusUrlFor", "parseStatus", "resolveAddresses", "requestJson", "probeResult", "curlExample"];

/**
 * Fail the build when the UI reaches for a model helper the namespace omits.
 *
 * The namespace is an explicit list, not the module's real exports, so a helper
 * added to `model.js` and used in `ui.js` but never registered here would build
 * cleanly and then throw in the browser at first use.
 *
 * @param sources - transformed source texts that reference the namespace.
 */
function assertModelExports(sources) {
	// Prose refers to the file as `model.js`; scan code only.
	const code = sources.map((text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, ""));
	const used = new Set();
	for (const text of code) for (const match of text.matchAll(/\bmodel\.([A-Za-z_$][\w$]*)/g)) used.add(match[1]);
	const missing = [...used].filter((name) => !MODEL_EXPORTS.includes(name));
	if (missing.length > 0) throw new Error(`client/build.mjs: MODEL_EXPORTS is missing ${missing.join(", ")} (used by the UI)`);
}

/**
 * Rewrite one authored module into factory-scope statements.
 * @param source - module source text.
 * @param file - path used in error messages.
 * @returns transformed statements.
 */
function transform(source, file) {
	const lines = source.split("\n").map((line, index) => {
		const where = `${file}:${String(index + 1)}`;
		const trimmed = line.trim();
		if (/^import\s+React\s+from\s+["']react["'];?$/.test(trimmed)) return line.replace(trimmed, 'const React = require("react");');
		if (/^import\s+.*from\s+["']\.\/[^"']+["'];?$/.test(trimmed)) return undefined;
		if (/^import\s+["']\.\/[^"']+["'];?$/.test(trimmed)) return undefined;
		const named = trimmed.match(/^import\s+\{([^}]*)\}\s+from\s+["']([^"']+)["'];?$/);
		if (named !== null) return line.replace(trimmed, `const {${named[1]}} = require(${JSON.stringify(named[2])});`);
		if (/^import\s+.*from\s+["'][^."']/.test(trimmed)) throw new Error(`${where}: a bare-module default import is not bundled; require it or use a named import`);
		if (/^import\b/.test(trimmed)) throw new Error(`${where}: unsupported import; only "react", "react-dom", and relative ./ imports are bundled`);
		if (/^export\s+(default\b|\{)/.test(trimmed)) throw new Error(`${where}: unsupported export form`);
		if (/^export\s+/.test(trimmed)) return line.replace(/^(\s*)export\s+/, "$1");
		if (/^export\b/.test(trimmed)) throw new Error(`${where}: unsupported export statement`);
		return line;
	});
	const text = lines.filter((line) => line !== undefined).join("\n");
	if (/^import\b/m.test(text) || /^export\b/m.test(text)) throw new Error(`${file}: transform left a top-level import/export`);
	return text.replace(/\s+$/, "");
}

/** Render the full artifact. */
function build() {
	const css = read("client/styles.css").replace(/\s+$/, "");
	const ui = transform(read("client/ui.js"), "client/ui.js");
	const entry = transform(read("client/entry.js"), "client/entry.js");
	assertModelExports([ui, entry]);
	return `/**
 * GENERATED FILE — do not edit.
 * Built from client/model.js, client/ui.js, client/entry.js, and
 * client/styles.css by \`node client/build.mjs\`. Edit the sources and rebuild.
 */
window.__ModuleLoader__.load({
\tid: "dsh-openai-api",
\tfactory: (require) => {
\t\tconst STYLE_ID = "dsh-openai-api-styles";
\t\tconst CSS = ${JSON.stringify(css)};
\t\t{
\t\t\tconst existing = document.getElementById(STYLE_ID);
\t\t\tconst style = existing !== null && existing !== void 0 ? existing : document.createElement("style");
\t\t\tstyle.id = STYLE_ID;
\t\t\tstyle.textContent = CSS;
\t\t\tif (existing === null) document.head.appendChild(style);
\t\t}

\t\t//#region client/model.js
\t\tconst model = (() => {
${transform(read("client/model.js"), "client/model.js")}
\t\t\treturn { ${MODEL_EXPORTS.join(", ")} };
\t\t})();
\t\t//#endregion

\t\t//#region client/ui.js
${ui}
\t\t//#endregion

\t\t//#region client/entry.js
${entry}
\t\t//#endregion

\t\treturn { name, inject, apply };
\t},
});
`;
}

const artifact = build();
if (process.argv.includes("--check")) {
	const current = read("lib/client.js");
	if (current !== artifact) {
		console.error("lib/client.js is out of date; run: node client/build.mjs");
		process.exit(1);
	}
	console.log("lib/client.js is up to date");
} else {
	writeFileSync(fileURLToPath(new URL("lib/client.js", ROOT)), artifact);
	console.log("wrote lib/client.js");
}
