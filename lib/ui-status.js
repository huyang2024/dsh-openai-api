/**
 * Read-only, explicitly allowlisted status for the bundled browser UI.
 *
 * Two independent delivery paths publish the same descriptor:
 *   - `mountUiStatus` exposes it as a JSON route on the Host Connection
 *     service, which owns authentication, Host/Origin admission, and
 *     owner-only access;
 *   - `mountUiSnapshot` injects the same object into the authenticated index
 *     response as a page global, so the panel still works when a request
 *     cannot be made.
 *
 * Neither path may carry a credential, and neither is served from public
 * plugin assets.
 */

/** Global the index snapshot installs in the page. */
export const SNAPSHOT_GLOBAL = "__DSH_OPENAI_API__";

/** Read the bound listener's display origin without requiring it to be ready. */
function listenerOrigin(webServer) {
	try {
		if (typeof webServer?.getOrigin !== "function") return null;
		const origin = webServer.getOrigin();
		return typeof origin === "string" ? origin : null;
	} catch {
		// A listener can exist before its port is bound, or lack a URL form.
		return null;
	}
}

/**
 * The complete published descriptor. Adding a field here publishes it to the
 * browser, so keep it to routing facts a caller could read from the surface.
 */
function descriptorOf(config, webServer) {
	return {
		schemaVersion: 1,
		pathPrefix: config.pathPrefix,
		model: config.model,
		authRequired: Boolean(config.apiKeys.length),
		listenerOrigin: listenerOrigin(webServer),
		listenPort: webServer?.port ?? null,
	};
}

/**
 * Mount the optional browser descriptor without changing the OpenAI API.
 *
 * Connection owns the registration as an effect of the injected child context;
 * withdrawing that service or this plugin removes the route automatically.
 * No extra ctx.effect or manual disposer is needed around fetch.register().
 * Older hosts/test contexts without injection support simply omit the UI route.
 *
 * @param {object} ctx - Host plugin context.
 * @param {object} config - Already validated host configuration; never serialized wholesale.
 * @param {object} webServer - Bound listener used only for display metadata.
 * @returns {unknown} The context-owned injection handle, or undefined when unsupported.
 */
export function mountUiStatus(ctx, config, webServer) {
	if (typeof ctx?.inject !== "function") return;
	return ctx.inject(["connection"], (scoped) => {
		const routes = scoped.connection?.fetch;
		if (typeof routes?.register !== "function") return;
		routes.register({
			path: "/api/openai-api/status",
			methods: ["GET"],
			requestBody: "buffered",
			fetch: async () => Response.json(descriptorOf(config, webServer), {
				headers: {
					"cache-control": "no-store",
					"x-content-type-options": "nosniff",
				},
			}),
		});
	});
}

/**
 * Contribute the same descriptor as a boot-time page global.
 *
 * The row is read while the authenticated index renders, so its value is live
 * per page load and never needs an unauthenticated route. Hosts that do not
 * emit `webserver/index-inject` simply never read the row.
 *
 * @param {object} ctx - Host plugin context.
 * @param {object} config - Already validated host configuration.
 * @param {object} webServer - Bound listener used only for display metadata.
 * @returns {unknown} The effect handle, or undefined when the host cannot take it.
 */
export function mountUiSnapshot(ctx, config, webServer) {
	if (typeof ctx?.on !== "function" || typeof ctx?.effect !== "function") return;
	return ctx.effect(() => ctx.on("webserver/index-inject", (table) => {
		if (!Array.isArray(table)) return;
		table.push({ kind: "global", name: SNAPSHOT_GLOBAL, value: descriptorOf(config, webServer) });
	}), "openai-api: index snapshot");
}
