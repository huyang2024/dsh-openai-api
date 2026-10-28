/**
 * Plugin body for the browser half.
 *
 * The build step concatenates `model.js`, `ui.js`, and this file into the
 * factory of `lib/client.js`, so these module-scope bindings (`React`, `model`)
 * are already defined there; the import lines below only keep this file valid
 * standalone ESM.
 */
import React from "react";
import * as model from "./model.js";
import { createUi } from "./ui.js";

/** Stable Cordis plugin name for the browser half. */
export const name = "openai-api-ui";

/** Only the slot registry is required; React comes from the shared seed table. */
export const inject = ["slots"];

/**
 * Register the sidebar footer action.
 *
 * The sidebar owns the row geometry and passes `wide` (false in the 56px rail),
 * so the entry only decides what the row and its detail look like.
 *
 * @param ctx - Client root context.
 */
export function apply(ctx) {
	const { Entry } = createUi(React, model);
	ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
		name: "sidebar.footer.action",
		id: "openai-api",
		order: 50,
		label: "API",
	}, Entry));
}
