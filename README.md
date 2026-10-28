# dsh-openai-api

OpenAI-compatible HTTP surface for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), backed by **real DSH agent sessions**.

After this plugin is installed into a dsh profile, the harness web server additionally serves:

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/chat/completions` | Chat Completions API (streaming + non-streaming) |
| `POST /v1/responses` | Responses API subset (streaming + non-streaming) |
| `GET /v1/models` | Advertised model id |

It also adds an **API** row at the sidebar foot (above Settings) showing the live base URL and port — see [Sidebar panel](#sidebar-panel).

## What "agent-backed" means

Each request is served by a **live DSH agent session** (the harness `agents` registry + the agent loop), so every call gets the agent's full world: its configured tools, bash/files access, skills, prompt sections, and preset persona. This is an **agent gateway**, not a thin LLM proxy:

- The **agent owns tool use**. Client-side `tools` / `tool_choice` / function-call messages are rejected on both endpoints (`/v1/responses` no longer ignores them silently) — the agent decides what tools to call and why.
- Chat deltas arrive **once per committed assistant message**, not per token. Responses sends lifecycle events first and the accumulated text after the turn ends. Neither endpoint exposes reasoning, tool calls or token-level chunks.
- `/v1/responses` sends its `response.created` / `in_progress` lifecycle events as soon as the turn starts, so a long answer never looks hung, and a mid-turn failure closes the stream with an explicit `event: error`. A chat stream that dies mid-turn now emits an error frame before `[DONE]`.
- The first request for a `(key, preset, session)` triple **seeds** a session by rendering the client's full message array into a labeled transcript prompt; later requests admit only the latest user turn (the session already holds the history).

## Session identity

`(API key tenant, X-Agent-Preset, X-Session-Id)`:

- The accepted **apiKey namespaces the caller** — one session per key, so different keys never share a session even for the same preset, and a client resumes its own session on reconnect.
- The **`X-Agent-Preset` header** names the preset the session joins (absent → the profile default). Resolved only at session creation.
- The optional **`X-Session-Id` header** (usually a URL-encoded role name) splits sessions further per role and is used as the session title. The mapping is persisted, so a profile restart resumes the previous session; a session that has been archived is recreated.

## Install

```sh
# from GitHub
dsh plugin --profile web add github:huyang2024/dsh-openai-api

# or from a local checkout
dsh plugin --profile web add file:/absolute/path/to/dsh-openai-api
```

The package declares a DSH bundle and automatically contributes the `openai-api` component when newly installed into a profile, so no manual `insert:` is needed. Installing it from the Desktop Plugins page and choosing **Enable now** applies immediately; installing through the CLI requires a profile restart.

For DSH Desktop, initialize the app once, fully quit it, and use the desktop app's bundled `dsh` command with `--profile desktop` instead of `--profile web` (register it from the app's **Manage dsh Command…** menu). The npm-installed CLI cannot manage the desktop profile. You can also install this package from the desktop Plugins page using the GitHub spec or an absolute local checkout path, then choose **Enable now**.

Desktop uses a dynamically assigned HTTP port by default, rather than `3080`. Use its actual listening address as the API base URL — the **API** row at the sidebar foot shows it, so the port never has to be hunted down; `GET /v1/models` checks that the plugin is running without calling a model.

To customize the component, update the existing row in the profile's user patch layer — `$DSH_HOME/profiles/web/cordis.patch.yml` (or `profiles/desktop/cordis.patch.yml` for Desktop):

```yaml
- id: openai-api
  config:
    pathPrefix: '/v1'     # optional, default shown
    model: default        # optional; model id advertised at /v1/models
    # provider: my-provider    # optional; omit to use the host default provider
    # cwd: /absolute/workdir   # optional; omit to use the `dsh web` process cwd
    # apiKeys:                 # optional; omit for one keyless loopback-only tenant
    #   - local-key
```

Omit an optional key entirely rather than writing an empty value. `apiKeys: []` now means the same as omitting it (the keyless loopback tenant), but `provider: ''` and `cwd: ''` are still rejected: `provider` must be a non-empty string and `cwd` an absolute path.

Restart the profile after editing its configuration.

## Sidebar panel

Once the plugin is enabled, an **API** row appears at the sidebar foot (above Settings), styled like the harness's own To-dos row: icon, title, muted port, chevron. It starts collapsed; clicking it reveals the detail **upwards** (the toggle keeps its place first in the DOM, so tab and screen-reader order are unchanged), and the chevron flips down while open.

- **After the first successful open**, the collapsed row retains the port. Desktop shows the actual runtime-assigned HTTP port.
- **Expanding checks once by itself**: it reads the descriptor, then requests `GET <prefix>/models` — that lists models and never calls one.
- **The result shares the row with the button**: blue dot when the surface answers, red when it does not. The **Detect** button appears **only when the surface is unreachable**, as a retry; a `401` means the surface answered and wants a key, which counts as healthy and shows no button.
- **Base URL** is generated from the live listener and copies in one click; **Usage example** expands to a curl line and every endpoint path.
- **Auth / Model id** show whether a key is required, or that the surface is keyless and loopback-only.

The first open shows the full form with placeholder values. Subsequent opens keep the previous address and port visible while refreshing the descriptor and probing, rather than clearing the content first.

Hovering or opening uses the same fill as the settings and account navigation rows (a theme token, so it follows light and dark). The detail is height-capped and scrolls internally, so it never pushes out of the sidebar.

When the host displays a collapsed 56px rail, the entry becomes an icon button with details beside it. Its accessible name includes the full address after a successful read.

On Desktop the page is served over the app carrier, so the panel shows the **local HTTP address** to paste into other programs while the check still uses the current page. The panel never shows a key, only whether one is configured.

The panel reads `/api/openai-api/status` through DSH Connection, inheriting host origin checks, browser authentication and owner-only access; Desktop uses the same app carrier. The response contains only the schema version, prefix, model, key-required flag, listener origin and port — never key contents, provider or cwd.

A failed first read shows its reason and a retry button. A failed refresh keeps the previous address, marks the surface unavailable and offers detection; the next open re-reads the descriptor. The OpenAI endpoints are unaffected.

### Upgrading an existing installation

The package is now named `dsh-openai-api`. If you installed the old scoped package, uninstall it before installing this version.

Earlier versions installed as plain dependencies without a bundle declaration. After updating the package, enable it on the Plugins page; the CLI does not automatically enable a dependency that was already installed. Alternatively, add `dsh-openai-api` to the existing `dsh.profile.bundles` array in the profile's `package.json`, preserving the other entries.

If you previously added an `insert:` block for `openai-api`, replace just that entry with the `id`/`config` override above, keeping your configuration values and any unrelated entries. The bundle now owns the component insertion.

## Configuration

All keys optional; created sessions fall back to the host defaults.

| key | default | what it does |
| --- | --- | --- |
| `model` | `default` | Model id advertised at `/v1/models`. A request's `model` (absent, or this id) uses the host default selection; any other id is passed to the session as the model. |
| `provider` | host default | Provider route for created sessions. |
| `apiKeys` | unset (= `[]`) | Per-client keys. Each distinct key is a separate tenant — one session per `(key, preset, session)`. When set, a request must present one (`Authorization: Bearer <key>`); otherwise it is a 401. Unset, the surface is a single keyless tenant restricted to **loopback** callers. |
| `cwd` | the `dsh web` process's cwd | Absolute working directory for created sessions. POSIX starts with `/`; Windows accepts `D:/dir` or `D:\dir`. |
| `pathPrefix` | `/v1` | Route prefix for all three endpoints. |
| `sessionMapPath` | `$DSH_HOME/openai-api/session-map.json` | Where the role-session map is written (absolute). Keyed by the SHA-256 of `(tenant, preset, session)` — never the key itself — written 0600, atomically, capped at 200 entries. |
| `maxBodyBytes` | `33554432` | Maximum accepted JSON request body in bytes. |
| `allowedOrigins` | unset | Extra browser origins allowed to call cross-origin (exact origin strings). |

## Using the API

Use the Base URL the sidebar **API** row shows (Desktop assigns the port dynamically):

```js
import OpenAI from 'openai'
const client = new OpenAI({ baseURL: 'http://127.0.0.1:3080/v1', apiKey: 'local-key' })

// Optional: choose the agent preset the session joins (absent → default preset).
const preset = { 'X-Agent-Preset': 'custom-agent-preset' }

const reply = await client.chat.completions.create(
  { model: 'default', messages: [{ role: 'user', content: 'What are you?' }] },
  { headers: preset },
)
```

`/v1/responses` follows the same session model: its `instructions` act as a first-turn system message, and `previous_response_id` is echoed back without being used for lookup (the sticky session is the store). Hitting the token limit reports `status: "incomplete"` with `incomplete_details`.

## Auth and trust

- With `apiKeys` set, an exact `Authorization: Bearer <key>` is required and the matched key is the tenant.
- Without `apiKeys`, only **loopback** callers are served (a deliberate hardening over the reference implementation, so an accidental LAN bind never exposes unauthenticated agent access).
- Browser cross-origin calls from other origins are rejected outright — a valid key does **not** bypass the origin fence; list the origin in `allowedOrigins` when cross-origin access is genuinely needed. Preflight `OPTIONS` is answered on all three paths.

## Local development

```sh
node --check lib/index.js     # syntax
node client/build.mjs         # build lib/client.js (browser half) from client/ sources
npm test                      # unit tests plus the protocol smoke test
node test/smoke.mjs           # the protocol smoke test alone
```

The browser half is built from:

| File | Role |
| --- | --- |
| `client/model.js` | Pure helpers: descriptor validation, address derivation, probe classification, curl example |
| `client/ui.js` | The collapsible row and its detail (shared React plus `model` only) |
| `client/entry.js` | Registers the `sidebar.footer.action` slot |
| `client/styles.css` | Styling, on the DSH theme tokens |

`lib/client.js` is generated: edit `client/` sources and rebuild; `node client/build.mjs --check` verifies synchronization. The build derives export names from the pure model module, with no second list to maintain, and checks generated syntax before writing.

`npm test` discovers tests automatically. Protocol tests use fake agents, temporary loopback ports and isolated temporary session maps, releasing resources afterwards. They never call a real model or modify a user session map. Build tests likewise run in temporary copies.
