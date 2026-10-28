/**
 * Unit tests for the host-side boot snapshot in `lib/ui-status.js`.
 *
 * The snapshot is the fallback path the panel prefers, so these tests pin its
 * shape, its allowlist, and its tolerance of hosts that cannot take an effect.
 * Authentication of the index response belongs to the host and is not asserted
 * here.
 */
import assert from "node:assert/strict";
import test from "node:test";

const { mountUiSnapshot, SNAPSHOT_GLOBAL } = await import("../lib/ui-status.js");

const config = (overrides = {}) => ({ pathPrefix: "/v1", model: "default", apiKeys: [], ...overrides });
const webServer = (overrides = {}) => ({ getOrigin: () => "http://127.0.0.1:57781", port: 57781, ...overrides });

/** A context that records the index-inject subscriber and its effect. */
function makeCtx() {
	const listeners = new Map();
	const effects = [];
	return {
		ctx: {
			on(event, handler) {
				listeners.set(event, handler);
				return () => listeners.delete(event);
			},
			effect(callback, label) {
				const disposer = callback();
				effects.push({ label, disposer });
				return disposer;
			},
		},
		listeners,
		effects,
		emitTable() {
			const table = [];
			listeners.get("webserver/index-inject")(table);
			return table;
		},
	};
}

test("contributes one page global holding the allowlisted descriptor", () => {
	const { ctx, listeners, effects, emitTable } = makeCtx();
	const handle = mountUiSnapshot(ctx, config(), webServer());
	assert.notEqual(handle, undefined);
	assert.equal(typeof listeners.get("webserver/index-inject"), "function");
	assert.equal(effects.length, 1);
	assert.match(effects[0].label, /snapshot/);
	assert.deepEqual(emitTable(), [{
		kind: "global",
		name: SNAPSHOT_GLOBAL,
		value: {
			schemaVersion: 1,
			pathPrefix: "/v1",
			model: "default",
			authRequired: false,
			listenerOrigin: "http://127.0.0.1:57781",
			listenPort: 57781,
		},
	}]);
});

test("publishes no credential or unrelated configuration", () => {
	const { ctx, emitTable } = makeCtx();
	mountUiSnapshot(ctx, { pathPrefix: "/v1", model: "default", apiKeys: ["secret-key"], provider: "p", cwd: "/tmp", maxBodyBytes: 1024, allowedOrigins: ["https://x"] }, webServer());
	const row = emitTable()[0];
	assert.deepEqual(Object.keys(row.value).sort(), ["authRequired", "listenPort", "listenerOrigin", "model", "pathPrefix", "schemaVersion"]);
	assert.equal(JSON.stringify(row).includes("secret-key"), false);
	assert.equal(row.value.authRequired, true, "a configured key set flips the flag without publishing the keys");
});

test("reads the listener live on every index render", () => {
	const { ctx, emitTable } = makeCtx();
	const server = webServer();
	mountUiSnapshot(ctx, config({ pathPrefix: "/openai" }), server);
	assert.equal(emitTable()[0].value.listenPort, 57781);
	server.port = 61000;
	server.getOrigin = () => "http://127.0.0.1:61000";
	assert.equal(emitTable()[0].value.listenPort, 61000);
	assert.equal(emitTable()[0].value.listenerOrigin, "http://127.0.0.1:61000");
	assert.equal(emitTable()[0].value.pathPrefix, "/openai");
});

test("survives a listener whose origin is unreadable and a foreign table", () => {
	const { ctx, listeners } = makeCtx();
	mountUiSnapshot(ctx, config(), { port: undefined, getOrigin: () => { throw new Error("not bound"); } });
	const table = [];
	listeners.get("webserver/index-inject")(table);
	assert.deepEqual(table[0].value.listenerOrigin, null);
	assert.equal(table[0].value.listenPort, null);
	const sentinel = { not: "an array" };
	assert.doesNotThrow(() => listeners.get("webserver/index-inject")(sentinel));
});

test("older contexts without the event or effect API quietly skip", () => {
	assert.equal(mountUiSnapshot({}, config(), webServer()), undefined);
	assert.equal(mountUiSnapshot({ on() {} }, config(), webServer()), undefined);
	assert.equal(mountUiSnapshot({ effect() {} }, config(), webServer()), undefined);
	assert.equal(mountUiSnapshot(undefined, config(), webServer()), undefined);
});
