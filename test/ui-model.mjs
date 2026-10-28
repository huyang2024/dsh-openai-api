/**
 * Unit tests for the browser-side helpers in `client/model.js`.
 *
 * These cover descriptor validation and address derivation only. Nothing here
 * reaches a host, so authentication and the real `/api` route stay the host's
 * contract (see test/ui-status.mjs for the host registration).
 */
import assert from "node:assert/strict";
import test from "node:test";

const model = await import("../client/model.js");

const descriptor = (overrides = {}) => ({
	schemaVersion: 1,
	pathPrefix: "/v1",
	model: "default",
	authRequired: false,
	listenerOrigin: "http://127.0.0.1:57781",
	listenPort: 57781,
	...overrides,
});

test("parseStatus accepts the allowlisted descriptor and normalizes it", () => {
	assert.deepEqual(model.parseStatus(descriptor()), {
		pathPrefix: "/v1",
		model: "default",
		authRequired: false,
		listenerOrigin: "http://127.0.0.1:57781",
		listenPort: 57781,
	});
	assert.equal(model.parseStatus(descriptor({ pathPrefix: "/v1/" })).pathPrefix, "/v1");
	assert.equal(model.parseStatus(descriptor({ listenerOrigin: null })).listenerOrigin, null);
	assert.equal(model.parseStatus(descriptor({ listenPort: 0 })).listenPort, null);
	assert.equal(model.parseStatus(descriptor({ listenPort: 70000 })).listenPort, null);
});

test("parseStatus rejects anything the panel cannot safely render", () => {
	const bad = [
		null,
		{},
		descriptor({ schemaVersion: 2 }),
		descriptor({ pathPrefix: "" }),
		descriptor({ pathPrefix: "v1" }),
		descriptor({ pathPrefix: "//evil.test/v1" }),
		descriptor({ pathPrefix: "/v1 models" }),
		descriptor({ pathPrefix: "/v1?x=1" }),
		descriptor({ pathPrefix: "/a/../b" }),
		descriptor({ model: "" }),
		descriptor({ authRequired: "yes" }),
		descriptor({ listenerOrigin: "file:///tmp" }),
		descriptor({ listenerOrigin: "http://user:pass@127.0.0.1:1" }),
		descriptor({ listenerOrigin: "http://127.0.0.1:57781/sub" }),
	];
	for (const value of bad) assert.throws(() => model.parseStatus(value), /invalid_status/, JSON.stringify(value));
});

test("resolveAddresses keeps web pages on their own origin and root path", () => {
	const addresses = model.resolveAddresses(model.parseStatus(descriptor()), "http://127.0.0.1:57781/");
	assert.equal(addresses.baseUrl, "http://127.0.0.1:57781/v1");
	assert.equal(addresses.probeUrl, "http://127.0.0.1:57781/v1/models");
	assert.equal(addresses.port, 57781);
	assert.equal(addresses.offCarrier, false);
	// The panel renders these straight from the descriptor.
	assert.equal(addresses.model, "default");
	assert.equal(addresses.authRequired, false);
	assert.equal(addresses.listenerOrigin, "http://127.0.0.1:57781");
});

test("resolveAddresses ignores the page mount path", () => {
	const addresses = model.resolveAddresses(model.parseStatus(descriptor({ pathPrefix: "/openai" })), "http://host.test:3080/some/mount/");
	assert.equal(addresses.baseUrl, "http://host.test:3080/openai");
	assert.equal(addresses.probeUrl, "http://host.test:3080/openai/models");
});

test("resolveAddresses shows the listener address on a desktop carrier", () => {
	const addresses = model.resolveAddresses(model.parseStatus(descriptor()), "dsh-app://app/");
	assert.equal(addresses.baseUrl, "http://127.0.0.1:57781/v1");
	// The probe stays on the carrier that injects the shell credential.
	assert.equal(addresses.probeUrl, "dsh-app://app/v1/models");
	assert.equal(addresses.offCarrier, true);
});

test("resolveAddresses degrades when the listener has no URL form", () => {
	const addresses = model.resolveAddresses(model.parseStatus(descriptor({ listenerOrigin: null })), "dsh-app://app/");
	assert.equal(addresses.baseUrl, null);
	assert.equal(addresses.port, 57781);
	assert.equal(addresses.probeUrl, "dsh-app://app/v1/models");
});

test("resolveAddresses reports the default port for a scheme that omits it", () => {
	const addresses = model.resolveAddresses(model.parseStatus(descriptor({ listenerOrigin: "https://agent.test" })), "https://agent.test/");
	assert.equal(addresses.baseUrl, "https://agent.test/v1");
	assert.equal(addresses.port, 443);
});

test("statusUrlFor resolves at the server root on every carrier", () => {
	assert.equal(model.statusUrlFor("http://127.0.0.1:57781/some/mount/"), "http://127.0.0.1:57781/api/openai-api/status");
	assert.equal(model.statusUrlFor("dsh-app://app/"), "dsh-app://app/api/openai-api/status");
});

test("requestJson returns the status and parses JSON only when it is JSON", async () => {
	const jsonFetcher = async (url, init) => {
		assert.equal(url, "http://127.0.0.1:57781/v1/models");
		assert.equal(init.method, "GET");
		assert.equal(init.credentials, "same-origin");
		assert.equal(init.cache, "no-store");
		return { ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ object: "list", data: [] }) };
	};
	assert.deepEqual(await model.requestJson(jsonFetcher, "http://127.0.0.1:57781/v1/models"), { status: 200, body: { object: "list", data: [] } });

	const htmlFetcher = async () => ({ ok: true, status: 200, headers: new Headers({ "content-type": "text/html" }), json: async () => ({ object: "list" }) });
	assert.deepEqual(await model.requestJson(htmlFetcher, "http://x/"), { status: 200, body: null });

	const errorFetcher = async () => ({ ok: false, status: 401, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ error: {} }) });
	assert.deepEqual(await model.requestJson(errorFetcher, "http://x/"), { status: 401, body: null });
});

test("requestJson aborts on timeout and on the outer signal", async () => {
	const hanging = (url, init) => new Promise((resolve, reject) => {
		init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
	});
	await assert.rejects(() => model.requestJson(hanging, "http://x/", undefined, 20), (error) => error.name === "AbortError" || error.name === "TimeoutError");

	const controller = new AbortController();
	const pending = model.requestJson(hanging, "http://x/", controller.signal, 5000);
	controller.abort();
	await assert.rejects(() => pending, (error) => error.name === "AbortError" || error.name === "TimeoutError");
});

test("probeResult separates a healthy key-protected surface from a broken one", () => {
	assert.equal(model.probeResult({ status: 200, body: { object: "list", data: [{ id: "default" }] } }), "ok");
	assert.equal(model.probeResult({ status: 200, body: { object: "list", data: [] } }), "ok");
	assert.equal(model.probeResult({ status: 200, body: { object: "list", data: [{}] } }), "unexpected");
	assert.equal(model.probeResult({ status: 200, body: null }), "unexpected");
	assert.equal(model.probeResult({ status: 401, body: null }), "auth");
	assert.equal(model.probeResult({ status: 403, body: null }), "forbidden");
	assert.equal(model.probeResult({ status: 404, body: null }), "missing");
	assert.equal(model.probeResult({ status: 500, body: null }), "unexpected");
	assert.equal(model.probeResult(null), "unexpected");
});

test("curlExample quotes the address and only shows a key when one is required", () => {
	assert.equal(model.curlExample("http://127.0.0.1:57781/v1", false), "curl 'http://127.0.0.1:57781/v1/models'");
	assert.match(model.curlExample("http://127.0.0.1:57781/v1", true), /Authorization: Bearer YOUR_API_KEY/);
	assert.match(model.curlExample("http://x/it's", false), /'\\''/);
});
