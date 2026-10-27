# dsh-openai-api

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供标准 OpenAI 兼容 HTTP 接口的插件，由 **真实 DSH Agent 会话** 提供服务。

安装到 dsh 配置（profile）后，harness 的 Web 服务会额外提供：

| 接口 | 用途 |
| --- | --- |
| `POST /v1/chat/completions` | Chat Completions API（流式 + 非流式） |
| `POST /v1/responses` | Responses API 子集（流式 + 非流式） |
| `GET /v1/models` | 广告的模型 id |

## “Agent 承载”含义

每个请求由 **一个存活的 DSH Agent 会话** 服务（harness 的 `agents` 注册表 + agent 循环），因此每次调用都获得 agent 的完整世界：其配置的工具、bash/文件访问、技能、提示词分段和预设人格。这是 **agent 网关**，不是轻量 LLM 代理：

- **工具调用由 agent 自主决定**。客户端的 `tools` / `tool_choice` / function-call 消息会被拒绝——由 agent 决定调用哪些工具以及为什么。
- 流式 delta **按每一条已提交的 assistant 消息** 到达，而非按 token。思考、工具调用和 token 级块流都不上线路；只有已提交的 assistant 文本到达客户端。
- 每个 `(key, preset)` 组合的**首个请求**会通过把客户端完整消息数组渲染成带标签的转写提示来**播种**会话；后续请求只接收最新用户轮次（会话已持有历史）。

## 会话身份

`(API key 租户, X-Agent-Preset)`：

- 被接受的 **apiKey 为调用者命名空间** —— 每个 key 一个会话，因此不同 key 即使同 preset 也绝不共享会话，客户端重连会恢复自己的会话。
- **`X-Agent-Preset` 头** 指定会话加入的预设（缺省 → profile 默认预设）。仅在会话创建时解析。

## 安装

```sh
# 从 GitHub 安装
dsh plugin --profile web add github:huyang2024/dsh-openai-api

# 或本地目录安装
dsh plugin --profile web add file:/absolute/path/to/dsh-openai-api
```

包已声明 DSH 组合包，首次安装到 profile 时会自动加入 `openai-api` 组件。重启 profile 后生效，无需手动添加 `insert:`。

使用 DSH 桌面端时，先启动一次应用完成初始化，再完全退出，使用桌面端内置的 `dsh` 命令（通过应用菜单的“管理 dsh 命令…”注册），将上述命令的 `--profile web` 改为 `--profile desktop`。npm 安装的 CLI 不能管理桌面端 profile。也可以在桌面端的插件页面使用 GitHub 安装地址或本地仓库的绝对路径安装，然后点击“立即启用”。

桌面端默认使用动态分配的 HTTP 端口，而非 `3080`。调用 API 时请使用实际监听地址；`GET /v1/models` 可检查插件是否运行，不会调用模型。

如需自定义配置，在 profile 用户补丁层 `$DSH_HOME/profiles/web/cordis.patch.yml` 中修改已有组件（桌面端对应 `profiles/desktop/cordis.patch.yml`）：

```yaml
- id: openai-api
  config:
    pathPrefix: '/v1'     # 可选，默认值如此
    apiKeys: []           # 可选，见下表
    model: default        # 可选；/v1/models 广告的模型 id
    provider: ''          # 可选；创建会话使用的 provider 路由
    cwd: ''               # 可选；会话绝对工作目录
```

修改配置后重启 profile。

### 升级已有安装

包名现已改为 `dsh-openai-api`。如果安装过带作用域前缀的旧包，请先卸载旧包，再安装此版本。

旧版未声明组合包，只会作为普通依赖安装。更新包后，请在插件页面启用它；CLI 不会自动启用已经安装过的依赖。也可以在 profile 的 `package.json` 中，将 `dsh-openai-api` 加入已有的 `dsh.profile.bundles` 数组，并保留其它条目。

如果之前手动为 `openai-api` 添加了 `insert:` 条目，请只将该条目改为上面的 `id`/`config` 覆盖形式，保留原配置值和无关条目。组件的插入现在由组合包负责。

## 配置

所有键可选；创建的会话回退到宿主默认值。

| 键 | 默认 | 作用 |
| --- | --- | --- |
| `model` | `default` | `/v1/models` 广告的模型 id。请求 `model`（缺省或等于此值）时使用宿主默认选择；其它 id 作为模型传入会话。 |
| `provider` | 宿主默认 | 创建会话使用的 provider 路由。 |
| `apiKeys` | 未设 | 每客户端密钥。每个不同 key 是一个独立租户——每个 `(key, preset)` 一个会话。设置后，请求必须携带一个（`Authorization: Bearer <key>`），否则 401。未设置时，表面是单个无密钥租户，**仅限本机回环** 调用。 |
| `cwd` | `dsh web` 进程 cwd | 创建会话的绝对工作目录。必须以 `/` 开头。 |

## 使用 API

```js
import OpenAI from 'openai'
const client = new OpenAI({ baseURL: 'http://127.0.0.1:3080/v1', apiKey: 'local-key' })

// 可选：指定会话加入的 agent 预设（缺省 → 默认预设）。
const preset = { 'X-Agent-Preset': 'custom-agent-preset' }

const reply = await client.chat.completions.create(
  { model: 'default', messages: [{ role: 'user', content: 'What are you?' }] },
  { headers: preset },
)
```

`/v1/responses` 遵循同一会话模型；`previous_response_id` 被接受但忽略（粘性会话本身就是存储）。

## 鉴权与信任

- 设置了 `apiKeys`：需要精确的 `Authorization: Bearer <key>`，匹配到的 key 即租户。
- 未设置 `apiKeys`：仅服务 **本机回环** 调用者（这是在参考实现基础上的刻意加固，避免误绑局域网端口后暴露未鉴权的 agent 访问）。
- 其它 Origin 的浏览器跨域调用被拒绝，除非列入 `allowedOrigins` 或携带有效密钥。三条路径都响应 `OPTIONS` 预检。

## 本地开发

```sh
node --check lib/index.js     # 语法检查
node test/smoke.mjs           # 基于假 agents 服务的协议测试
```
