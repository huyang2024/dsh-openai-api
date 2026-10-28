/** Registration contract only; authentication remains the real Host's job. */
import assert from "node:assert/strict";
import test from "node:test";
import { mountUiStatus } from "../lib/ui-status.js";

const config = { pathPrefix: "/v1", model: "default", apiKeys: [] };
const server = { port: 57781, getOrigin() { return `http://127.0.0.1:${this.port}`; } };
const expected = { schemaVersion: 1, pathPrefix: "/v1", model: "default", authRequired: false, listenerOrigin: server.getOrigin(), listenPort: server.port };
const forbidden = new Proxy({}, { get() { throw new Error("private value accessed"); } });

function install(settings = config, listener = server) {
	let activate;
	const handle = {};
	const result = mountUiStatus({
		inject(keys, callback) {
			assert.deepEqual(keys, ["connection"]);
			activate = callback;
			return handle;
		},
		get agents() { throw new Error("must not call agents"); },
		effect() { throw new Error("Connection owns disposal"); },
	}, settings, listener);
	assert.equal(result, handle);
	let route;
	const scope = { connection: { fetch: { register(value) {
		route = value;
		return () => { route = undefined; };
	} } } };
	assert.equal(route, undefined, "registration waits for Connection");
	assert.equal(activate(scope), undefined, "do not return a second disposer");
	return { route, activate };
}

async function read(route) {
	const response = await route.fetch();
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("cache-control"), "no-store");
	assert.equal(response.headers.get("x-content-type-options"), "nosniff");
	assert.match(response.headers.get("content-type"), /^application\/json/);
	return response.json();
}

test("registers an exact authenticated GET with a six-field descriptor", async () => {
	const { route } = install();
	assert.deepEqual(Object.keys(route).sort(), ["fetch", "methods", "path", "requestBody"]);
	assert.equal(route.path, "/api/openai-api/status");
	assert.deepEqual(route.methods, ["GET"]);
	assert.equal(route.requestBody, "buffered");
	assert.deepEqual(await read(route), expected);
});

test("never reads key contents or serializes private configuration", async () => {
	const settings = new Proxy({ ...config, pathPrefix: "/custom", model: "custom", apiKeys: new Proxy([], {
		get(_, key) { if (key === "length") return 1; throw new Error("key contents accessed"); },
	}) }, {
		get(target, key) { if (Object.hasOwn(target, key)) return target[key]; throw new Error("private config accessed"); },
	});
	const { route } = install(settings);
	assert.deepEqual(await read(route), { ...expected, pathPrefix: "/custom", model: "custom", authRequired: true });
	assert.equal(route.path, "/api/openai-api/status");
});

test("reads live ports with the correct getOrigin receiver", async () => {
	const listener = { port: undefined, getOrigin() {
		assert.equal(this, listener);
		if (!this.port) throw new Error("not bound");
		return `http://127.0.0.1:${this.port}`;
	} };
	const { route } = install(config, listener);
	for (const port of [undefined, 60123, 60124]) {
		listener.port = port;
		assert.deepEqual(await read(route), { ...expected, listenPort: port ?? null, listenerOrigin: port ? listener.getOrigin() : null });
	}
});

test("missing or unusable listener origins stay null", async () => {
	for (const listener of [{}, { port: 0 }, { getOrigin: null }, { getOrigin() { throw new Error(); } }, { getOrigin() {} }]) {
		assert.deepEqual(await read(install(config, listener).route), { ...expected, listenerOrigin: null, listenPort: listener.port ?? null });
	}
});

test("unsupported Host faces skip without reading config or agents", () => {
	for (const ctx of [undefined, null, {}, { inject: null }]) assert.equal(mountUiStatus(ctx, forbidden, forbidden), undefined);
	for (const scoped of [{}, { connection: {} }, { connection: { fetch: {} } }]) {
		mountUiStatus({ inject(keys, callback) { assert.equal(callback(scoped), undefined); } }, forbidden, forbidden);
	}
});

test("replacement scopes own registration and cleanup, not the plugin", () => {
	const { activate } = install();
	for (let replacement = 0; replacement < 2; replacement++) {
		let current;
		let dispose;
		const scope = { connection: { fetch: { register(route) {
			assert.equal(current, undefined);
			current = route;
			return dispose = () => { current = undefined; };
		} } } };
		assert.equal(activate(scope), undefined);
		assert.equal(current.path, "/api/openai-api/status");
		dispose();
		assert.equal(current, undefined);
	}
});
