/**
 * Read-only, explicitly allowlisted status for the bundled browser UI.
 *
 * `mountUiStatus` exposes it as a JSON route on the Host Connection service,
 * which owns authentication, Host/Origin admission, and owner-only access. It
 * must never carry a credential, and must not be served from public plugin
 * assets.
 */

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
