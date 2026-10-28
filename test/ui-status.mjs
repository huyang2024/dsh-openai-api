/**
 * Unit tests for the descriptor and Cordis registration protocol only.
 * The fake registry deliberately does not implement authentication: Host
 * Connection's real /api admission and owner checks are not exercised here.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mountUiStatus } from "../lib/ui-status.js";

const STATUS_PATH = "/api/openai-api/status";

function config(overrides = {}) {
	return { pathPrefix: "/v1", model: "default", apiKeys: [], ...overrides };
}

/** Model Connection-owned effects and injected-service withdrawal/replacement. */
function harness() {
	const activeRoutes = new Map();
	const registrationCalls = [];
	const callbacks = [];
	let callback;
	let releaseScope;
	let disposed = false;
	let cleanupCalls = 0;
	const injection = { dispose };
	const ctx = {
		inject(keys, apply) {
			assert.deepEqual(keys, ["connection"]);
			assert.equal(callback, undefined, "only one injection registration");
			callback = apply;
			return injection;
		},
		get agents() { throw new Error("UI status must never access agents"); },
		get() { throw new Error("UI status must not discover unrelated services"); },
		effect() { throw new Error("Connection owns its own route effect"); },
	};
	function disconnect() {
		releaseScope?.();
		releaseScope = undefined;
	}
	function connect() {
		assert.equal(disposed, false);
		assert.equal(typeof callback, "function");
		disconnect();
		const effects = [];
		const scoped = {
			get agents() { throw new Error("UI status must never access agents"); },
			effect() { throw new Error("Do not double-wrap Connection's route effect"); },
			connection: {
				get fetch() {
					return {
						register(route) {
							assert.equal(activeRoutes.has(route.path), false);
							registrationCalls.push(route);
							activeRoutes.set(route.path, route);
							let released = false;
							const remove = () => {
								assert.equal(released, false, "route must be disposed once");
								released = true;
								cleanupCalls++;
								activeRoutes.delete(route.path);
							};
							effects.push(remove);
							return remove;
						},
					};
				},
			},
		};
		callbacks.push(callback(scoped));
		releaseScope = () => {
			for (const cleanup of effects) cleanup();
		};
	}
	function dispose() {
		if (disposed) return;
		disposed = true;
		disconnect();
	}
	return {
		ctx, injection, activeRoutes, registrationCalls, callbacks, connect, disconnect,
		get cleanupCalls() { return cleanupCalls; },
	};
}

function install(settings = config(), server = { port: 57781, getOrigin() { return "http://127.0.0.1:57781"; } }) {
	const env = harness();
	assert.equal(mountUiStatus(env.ctx, settings, server), env.injection);
	env.connect();
	return { ...env, route: env.activeRoutes.get(STATUS_PATH) };
}

async function descriptor(route) {
	const response = await route.fetch(new Request(`http://localhost${STATUS_PATH}`));
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("cache-control"), "no-store");
	assert.equal(response.headers.get("x-content-type-options"), "nosniff");
	assert.match(response.headers.get("content-type"), /^application\/json\b/);
	return response.json();
}

test("declares GET on Host Connection's exact-route registry", async () => {
	const { route } = install();
	assert.deepEqual(Object.keys(route).sort(), ["fetch", "methods", "path", "requestBody"]);
	assert.equal(route.path, STATUS_PATH);
	assert.deepEqual(route.methods, ["GET"]);
	assert.equal(route.requestBody, "buffered");
	assert.deepEqual(await descriptor(route), {
		schemaVersion: 1,
		pathPrefix: "/v1",
		model: "default",
		authRequired: false,
		listenerOrigin: "http://127.0.0.1:57781",
		listenPort: 57781,
	});
});

test("serializes only the allowlist, never raw config or credential values", async () => {
	const apiKeys = ["ui-test-secret-never-serialize"];
	apiKeys.toJSON = () => { throw new Error("API keys must not be serialized"); };
	const settings = {
		pathPrefix: "/custom/openai",
		model: "my-advertised-model",
		apiKeys,
		get provider() { throw new Error("provider is private"); },
		get cwd() { throw new Error("cwd is private"); },
		get allowedOrigins() { throw new Error("origins are private"); },
		toJSON() { throw new Error("raw host configuration must not be serialized"); },
	};
	const { route } = install(settings);
	const result = await descriptor(route);
	assert.deepEqual(result, {
		schemaVersion: 1,
		pathPrefix: "/custom/openai",
		model: "my-advertised-model",
		authRequired: true,
		listenerOrigin: "http://127.0.0.1:57781",
		listenPort: 57781,
	});
	assert.equal(JSON.stringify(result).includes(apiKeys[0]), false);
	assert.equal(route.path, STATUS_PATH, "API prefix must not relocate the management route");
});

test("reads actual listener port and origin for each request, not at mount", async () => {
	const server = {
		port: undefined,
		getOrigin() {
			assert.equal(this, server, "preserve WebServer method receiver");
			if (this.port === undefined) throw new Error("listener is not bound");
			return `http://127.0.0.1:${this.port}`;
		},
	};
	const { route } = install(config(), server);
	let result = await descriptor(route);
	assert.equal(result.listenerOrigin, null);
	assert.equal(result.listenPort, null);
	server.port = 60123;
	result = await descriptor(route);
	assert.equal(result.listenerOrigin, "http://127.0.0.1:60123");
	assert.equal(result.listenPort, 60123);
	server.port = 60124;
	result = await descriptor(route);
	assert.equal(result.listenerOrigin, "http://127.0.0.1:60124");
	assert.equal(result.listenPort, 60124);
});

test("missing, unsupported, or not-ready origins remain null", async () => {
	for (const server of [
		{},
		{ port: 0 },
		{ port: 4567, getOrigin: null },
		{ port: 4567, getOrigin() { throw new Error("no URL form"); } },
		{ port: 4567, getOrigin() { return undefined; } },
	]) {
		const { route } = install(config(), server);
		const result = await descriptor(route);
		assert.equal(result.listenerOrigin, null);
		assert.equal(result.listenPort, server.port ?? null);
	}
});

test("older contexts without inject quietly skip, without touching config or agents", () => {
	const unreadable = new Proxy({}, { get() { throw new Error("must not be read"); } });
	for (const ctx of [undefined, null, {}, { inject: null }]) {
		assert.equal(mountUiStatus(ctx, unreadable, unreadable), undefined);
	}
});

test("absent Connection waits; older Connection faces quietly omit the route", () => {
	const env = harness();
	mountUiStatus(env.ctx, config(), {});
	assert.equal(env.activeRoutes.size, 0, "no route before the service exists");
	assert.equal(env.registrationCalls.length, 0);
	for (const scoped of [{}, { connection: {} }, { connection: { fetch: {} } }]) {
		assert.doesNotThrow(() => mountUiStatus({
			inject(keys, callback) {
				assert.deepEqual(keys, ["connection"]);
				assert.equal(callback(scoped), undefined);
			},
		}, config(), {}));
	}
});

test("uses injected caller scope and Connection-owned cleanup across replacement", () => {
	const env = harness();
	assert.equal(mountUiStatus(env.ctx, config(), {}), env.injection);
	env.connect();
	assert.equal(env.activeRoutes.size, 1);
	assert.equal(env.registrationCalls.length, 1);
	assert.deepEqual(env.callbacks, [undefined], "do not return a second route disposer");
	env.disconnect();
	assert.equal(env.activeRoutes.size, 0);
	assert.equal(env.cleanupCalls, 1);
	env.connect();
	assert.equal(env.activeRoutes.size, 1);
	assert.equal(env.registrationCalls.length, 2);
	env.injection.dispose();
	assert.equal(env.activeRoutes.size, 0);
	assert.equal(env.cleanupCalls, 2);
	env.injection.dispose();
	assert.equal(env.cleanupCalls, 2);
});
