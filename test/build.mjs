/** Build tests run in a temporary mirror, never overwrite the working bundle. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function fixture(t) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "openai-build-")));
	for (const path of ["client", "lib", "package.json"]) cpSync(new URL(`../${path}`, import.meta.url), join(root, path), { recursive: true });
	t.after(() => {
		assert.equal(realpathSync(root), root);
		rmSync(root, { recursive: true });
	});
	return root;
}

function build(root, ...args) {
	return execFileSync(process.execPath, ["client/build.mjs", ...args], { cwd: root, encoding: "utf8" });
}

test("new model exports enter the namespace without a second export list", (t) => {
	const root = fixture(t);
	const file = join(root, "client/model.js");
	writeFileSync(file, `${readFileSync(file, "utf8")}\nexport const addedHelper = 42;\n`);
	build(root);
	const bundle = readFileSync(join(root, "lib/client.js"), "utf8");
	assert.match(bundle, /return \{[^}]*addedHelper/);
	assert.match(bundle, /const addedHelper = 42/);
	assert.match(build(root, "--check"), /up to date/);
});

test("check never writes, and malformed sources leave the last bundle intact", (t) => {
	const root = fixture(t);
	const output = join(root, "lib/client.js");
	build(root);
	const original = readFileSync(output, "utf8");
	const modified = statSync(output).mtimeMs;
	build(root, "--check");
	assert.equal(statSync(output).mtimeMs, modified);

	const ui = join(root, "client/ui.js");
	const source = readFileSync(ui, "utf8");
	writeFileSync(ui, `${source}\n// stale artifact\n`);
	assert.notEqual(spawnSync(process.execPath, ["client/build.mjs", "--check"], { cwd: root }).status, 0);
	for (const invalid of ['import "./missing.js";', 'export default 1;', 'export { createUi };', 'const broken = ;']) {
		writeFileSync(ui, `${source}\n${invalid}\n`);
		const result = spawnSync(process.execPath, ["client/build.mjs"], { cwd: root, encoding: "utf8" });
		assert.notEqual(result.status, 0, invalid);
		assert.match(result.stderr, /unsupported|SyntaxError/);
		assert.equal(readFileSync(output, "utf8"), original);
		assert.equal(statSync(output).mtimeMs, modified);
	}
});
