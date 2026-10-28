# dsh-openai-api

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供标准 OpenAI 兼容 HTTP 接口的插件，由 **真实 DSH Agent 会话** 提供服务。

安装到 dsh 配置（profile）后，harness 的 Web 服务会额外提供：

| 接口 | 用途 |
| --- | --- |
| `POST /v1/chat/completions` | Chat Completions API（流式 + 非流式） |
| `POST /v1/responses` | Responses API 子集（流式 + 非流式） |
| `GET /v1/models` | 广告的模型 id |

同时在侧栏底部提供一行 **API**（设置上方），显示当前接入地址与端口——见[侧栏接入面板](#侧栏接入面板)。

## “Agent 承载”含义

每个请求由 **一个存活的 DSH Agent 会话** 服务（harness 的 `agents` 注册表 + agent 循环），因此每次调用都获得 agent 的完整世界：其配置的工具、bash/文件访问、技能、提示词分段和预设人格。这是 **agent 网关**，不是轻量 LLM 代理：

- **工具调用由 agent 自主决定**。客户端的 `tools` / `tool_choice` / function-call 消息会被拒绝（两个端点一致，`/v1/responses` 不再静默忽略）——由 agent 决定调用哪些工具以及为什么。
- Chat 流式 delta **按每一条已提交的 assistant 消息** 到达，而非按 token；Responses 先发送生命周期事件，整轮结束后发送汇总文本。两者都不返回思考、工具调用或 token 级块流。
- `/v1/responses` 在轮次开始时就发出 `response.created` / `in_progress` 等生命周期事件，因此长回答不会看起来卡住；中途失败会以 `event: error` 显式收尾。Chat 流中途失败也会发出错误帧后再 `[DONE]`。
- 每个 `(key, preset, session)` 组合的**首个请求**会通过把客户端完整消息数组渲染成带标签的转写提示来**播种**会话；后续请求只接收最新用户轮次（会话已持有历史）。

## 会话身份

`(API key 租户, X-Agent-Preset, X-Session-Id)`：

- 被接受的 **apiKey 为调用者命名空间** —— 每个 key 一个会话，因此不同 key 即使同 preset 也绝不共享会话，客户端重连会恢复自己的会话。
- **`X-Agent-Preset` 头** 指定会话加入的预设（缺省 → profile 默认预设）。仅在会话创建时解析。
- **`X-Session-Id` 头**（可选，通常为 URL 编码的角色名）把会话再按角色拆分，并用作会话标题。映射会持久化，因此 profile 重启后可恢复上次的会话；已被归档的会话会自动重建。

## 安装

```sh
# 从 GitHub 安装
dsh plugin --profile web add github:huyang2024/dsh-openai-api

# 或本地目录安装
dsh plugin --profile web add file:/absolute/path/to/dsh-openai-api
```

包已声明 DSH 组合包，首次安装到 profile 时会自动加入 `openai-api` 组件，无需手动添加 `insert:`。在桌面端插件页面安装并「立即启用」会即时生效；用 CLI 安装则需要重启 profile。

使用 DSH 桌面端时，先启动一次应用完成初始化，再完全退出，使用桌面端内置的 `dsh` 命令（通过应用菜单的“管理 dsh 命令…”注册），将上述命令的 `--profile web` 改为 `--profile desktop`。npm 安装的 CLI 不能管理桌面端 profile。也可以在桌面端的插件页面使用 GitHub 安装地址或本地仓库的绝对路径安装，然后点击“立即启用”。

桌面端默认使用动态分配的 HTTP 端口，而非 `3080`。调用 API 时请使用实际监听地址——侧栏底部的 **API** 行会直接显示它，不必自己找端口；`GET /v1/models` 可检查插件是否运行，不会调用模型。

如需自定义配置，在 profile 用户补丁层 `$DSH_HOME/profiles/web/cordis.patch.yml` 中修改已有组件（桌面端对应 `profiles/desktop/cordis.patch.yml`）：

```yaml
- id: openai-api
  config:
    pathPrefix: '/v1'     # 可选，默认值如此
    model: default        # 可选；/v1/models 广告的模型 id
    # provider: my-provider    # 可选；省略则用宿主默认 provider
    # cwd: /absolute/workdir   # 可选；省略则用 dsh web 进程的 cwd
    # apiKeys:                 # 可选；省略表示单个无密钥租户（仅限本机回环）
    #   - local-key
```

可选键请把整行省略。`apiKeys: []` 与省略等价（都是无密钥回环租户）；`provider: ''`、`cwd: ''` 仍会被拒绝：`provider` 必须是非空字符串，`cwd` 必须是绝对路径。

修改配置后重启 profile。

## 侧栏接入面板

启用插件后，侧栏底部（设置上方）出现一行 **API**，样式与 harness 自己的「任务」行一致：图标 + 标题 + 淡色端口 + 右侧箭头。默认收起，点击后**向上展开**详情（DOM 顺序仍是按钮在前，键盘与读屏顺序不变），展开时箭头朝下。

- **首次展开读取成功后**，端口号会保留在收起行中；桌面端显示的是运行时实际分配的 HTTP 端口。
- **展开即自动检测一次**：先取接入信息，紧接着请求 `GET <prefix>/models`——只读模型列表，不调用模型。
- **检测结果**与按钮同一行：接口可达时是蓝点，不可达时是红点。「检测」按钮**只在不可达时出现**，用于重试；`401` 表示接口可达但需要密钥，按正常处理，不显示按钮。
- **接入地址**：按运行时生成，可一键复制；展开「接入示例」可看 curl 与各接口路径。
- **鉴权 / 模型 id**：显示「需要 API Key」或「免密钥 · 仅本机」。

首次展开先显示完整表单占位，再填入数值。再次展开时保留上次的地址和端口，同时刷新接入信息并检测，避免先清空内容造成闪动。

悬停或展开时，整行使用与设置、账号导航行相同的悬停底色（主题令牌，跟随深浅主题）。详情区域高度受限并内部滚动，不会顶出侧栏。

宿主以 56px 窄条显示侧栏时，入口变成图标按钮，详情在右侧显示；读取成功后的可访问名称包含完整接入地址。

桌面端页面经由应用通道访问，面板显示的是可复制到其它程序的**本机 HTTP 地址**，检测仍走当前页面。面板不展示任何密钥，只显示是否已配置。

面板通过 DSH Connection 的 `/api/openai-api/status` 读取接入信息，沿用宿主的来源校验、浏览器鉴权与 owner 校验；桌面端（`dsh-app:` 页面）使用同一应用通道。返回字段仅含协议版本、路径前缀、模型、是否需要密钥、监听地址与端口，不含密钥原文、provider 或 cwd。

首次读取失败会显示原因和「重试」；后续刷新失败保留原地址，显示不可用状态及「检测」，下次展开会重新读取。OpenAI 接口不受面板读取失败影响。

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
| `apiKeys` | 未设（等同 `[]`） | 每客户端密钥。每个不同 key 是一个独立租户——每个 `(key, preset, session)` 一个会话。设置后，请求必须携带一个（`Authorization: Bearer <key>`），否则 401。未设置（或显式空数组）时，表面是单个无密钥租户，**仅限本机回环** 调用。 |
| `cwd` | `dsh web` 进程 cwd | 创建会话的绝对工作目录。POSIX 以 `/` 开头；Windows 可用 `D:/dir` 或 `D:\dir`。 |
| `pathPrefix` | `/v1` | 三个接口的路由前缀。 |
| `sessionMapPath` | `$DSH_HOME/openai-api/session-map.json` | 角色会话映射的落盘位置（绝对路径）。用 `(tenant, preset, session)` 的 SHA-256 作键，不含密钥原文，文件权限 0600、原子写入、最多保留 200 条。 |
| `maxBodyBytes` | `33554432` | 接受的最大 JSON 请求体字节数。 |
| `allowedOrigins` | 未设 | 允许跨域调用的额外浏览器来源（精确 origin 字符串）。 |

## 使用 API

下面的端口与前缀用侧栏 **API** 行显示的接入地址（桌面端是动态端口）：

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

`/v1/responses` 遵循同一会话模型：它的 `instructions` 等同首轮的系统消息，`previous_response_id` 会被原样回显但不参与检索（粘性会话本身就是存储）。达到 max tokens 时返回 `status: "incomplete"` 与 `incomplete_details`。

## 鉴权与信任

- 设置了 `apiKeys`：需要精确的 `Authorization: Bearer <key>`，匹配到的 key 即租户。
- 未设置 `apiKeys`：仅服务 **本机回环** 调用者（这是在参考实现基础上的刻意加固，避免误绑局域网端口后暴露未鉴权的 agent 访问）。
- 其它 Origin 的浏览器跨域调用一律被拒绝，**不会**因为携带有效密钥而放行；需要跨域时把来源加入 `allowedOrigins`。三条路径都响应 `OPTIONS` 预检。

## 本地开发

```sh
node --check lib/index.js     # 语法检查
node client/build.mjs         # 由 client/ 源码生成 lib/client.js（浏览器半）
npm test                      # 单元测试 + 协议冒烟测试
node test/smoke.mjs           # 仅协议冒烟测试
```

浏览器半的源码结构：

| 文件 | 作用 |
| --- | --- |
| `client/model.js` | 纯函数：描述校验、地址推导、探测结果判定、curl 示例 |
| `client/ui.js` | 折叠行与详情（只用共享 React 和 `model`） |
| `client/entry.js` | 注册 `sidebar.footer.action` 槽位 |
| `client/styles.css` | 样式，沿用 DSH 主题令牌 |

`lib/client.js` 是生成文件；修改 `client/` 源码后重新构建，`node client/build.mjs --check` 可检查同步状态。构建从纯 model 模块自动取得导出名，不需要维护第二份名单，且会在写入前检查生成脚本的语法。

`npm test` 自动发现测试。协议冒烟测试使用假 Agent、回环临时端口和独立临时映射目录，结束时释放资源；不会调用真实模型或修改用户的会话映射。构建测试也只在临时副本中运行。
