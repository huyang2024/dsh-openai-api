/**
 * Read-only browser descriptor. Host Connection owns authentication, origin
 * checks, owner-only access and route disposal. Never expose raw configuration
 * through public plugin assets or register this directly on webServer.
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
			fetch: async () => {
				let listenerOrigin = null;
				try {
					const origin = webServer?.getOrigin?.();
					if (typeof origin === "string") listenerOrigin = origin;
				} catch {
					// The listener can exist before its port or URL is available.
				}
				return Response.json({
					schemaVersion: 1,
					pathPrefix: config.pathPrefix,
					model: config.model,
					authRequired: config.apiKeys.length > 0,
					listenerOrigin,
					listenPort: webServer?.port ?? null,
				}, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
			},
		});
	});
}
