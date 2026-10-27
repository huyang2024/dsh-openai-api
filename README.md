# dsh-openai-api

OpenAI-compatible HTTP surface for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), backed by **real DSH agent sessions**.

After this plugin is installed into a dsh profile, the harness web server additionally serves:

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/chat/completions` | Chat Completions API (streaming + non-streaming) |
| `POST /v1/responses` | Responses API subset (streaming + non-streaming) |
| `GET /v1/models` | Advertised model id |

## What "agent-backed" means

Each request is served by a **live DSH agent session** (the harness `agents` registry + the agent loop), so every call gets the agent's full world: its configured tools, bash/files access, skills, prompt sections, and preset persona. This is an **agent gateway**, not a thin LLM proxy:

- The **agent owns tool use**. Client-side `tools` / `tool_choice` / function-call messages are rejected — the agent decides what tools to call and why.
- Streaming deltas arrive **once per committed assistant message**, not per token. Reasoning, tool calls, and token-level chunk streams stay off the wire; only committed assistant text reaches the client.
- The first request for a `(key, preset)` pair **seeds** a session by rendering the client's full message array into a labeled transcript prompt; later requests admit only the latest user turn (the session already holds the history).

## Session identity

`(API key tenant, X-Agent-Preset)`:

- The accepted **apiKey namespaces the caller** — one session per key, so different keys never share a session even for the same preset, and a client resumes its own session on reconnect.
- The **`X-Agent-Preset` header** names the preset the session joins (absent → the profile default). Resolved only at session creation.

## Install

```sh
# from GitHub
dsh plugin --profile web add github:huyang2024/dsh-openai-api

# or from a local checkout
dsh plugin --profile web add file:/absolute/path/to/dsh-openai-api
```

The package declares a DSH bundle and automatically contributes the `openai-api` component when newly installed into a profile. Restart the profile to activate it. No manual `insert:` is needed.

For DSH Desktop, initialize the app once, fully quit it, and use the desktop app's bundled `dsh` command with `--profile desktop` instead of `--profile web` (register it from the app's **Manage dsh Command…** menu). The npm-installed CLI cannot manage the desktop profile. You can also install this package from the desktop Plugins page using the GitHub spec or an absolute local checkout path, then choose **Enable now**.

Desktop uses a dynamically assigned HTTP port by default, rather than `3080`. Use its actual listening address as the API base URL; `GET /v1/models` checks that the plugin is running without calling a model.

To customize the component, update the existing row in the profile's user patch layer — `$DSH_HOME/profiles/web/cordis.patch.yml` (or `profiles/desktop/cordis.patch.yml` for Desktop):

```yaml
- id: openai-api
  config:
    pathPrefix: '/v1'     # optional, default shown
    apiKeys: []           # optional; see below
    model: default        # optional; model id advertised at /v1/models
    provider: ''          # optional; provider route for created sessions
    cwd: ''               # optional; absolute working directory for sessions
```

Restart the profile after editing its configuration.

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
| `apiKeys` | unset | Per-client keys. Each distinct key is a separate tenant — one session per `(key, preset)`. When set, a request must present one (`Authorization: Bearer <key>`); otherwise it is a 401. Unset, the surface is a single keyless tenant restricted to **loopback** callers. |
| `cwd` | the `dsh web` process's cwd | Absolute working directory for created sessions. Must start with `/`. |

## Using the API

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

`/v1/responses` follows the same session model; `previous_response_id` is accepted and ignored (the sticky session is the store).

## Auth and trust

- With `apiKeys` set, an exact `Authorization: Bearer <key>` is required and the matched key is the tenant.
- Without `apiKeys`, only **loopback** callers are served (a deliberate hardening over the reference implementation, so an accidental LAN bind never exposes unauthenticated agent access).
- Browser cross-origin calls from other origins are rejected unless listed in `allowedOrigins`, or authenticated with a valid key. Preflight `OPTIONS` is answered on all three paths.

## Local development

```sh
node --check lib/index.js     # syntax
node test/smoke.mjs           # agent-backed protocol tests against a faked agents service
```
