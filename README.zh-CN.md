<p align="center"><img src="assets/icons/icon-256.png" width="96" alt="folio logo"></p>

[English](README.md) | **中文**

# folio

统一各 AI coding harness（Claude Code、Codex、Cursor、Kimi Code、ZCode）记忆的个人记忆库工具。

每家 harness 都有自己的一套记忆/规则存储，格式各异、互不相通。folio 把这些分散的记忆**单向导入**一个本地 file-based 记忆库（`~/.folio`），统一格式、统一检索，再通过 MCP server 把记忆库**服务回去**，让任何支持 MCP 的 harness 都能读到全部记忆。

## 三条设计原则

1. **单向导入**：只从 harness 的原生存储读，增量同步进记忆库；**绝不写回** harness 的原生目录。记忆库是唯一真相源，源文件删除后记忆仍保留在库中。
2. **统一格式**：所有记忆都是 Markdown + frontmatter，分为四类——`user`（用户偏好）、`feedback`（反馈与教训）、`project`（项目状态与决策）、`reference`（参考资料）。
3. **通过 MCP 服务回去**：记忆库通过 `folio serve`（stdio MCP server）提供给各 harness；不支持 MCP 的 harness 不做接入。

## 架构

```
┌────────────────────── 各 harness 原生存储（只读）──────────────────────┐
│ ~/.claude  ~/.codex  ~/.cursor  ~/.kimi-code  ~/.zcode  <项目>/.*     │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ ① 导入（adapters，增量 sync / watch）
                                   ▼
                        ┌─────────────────────┐
                        │ 整理（organize）     │  LLM 或本地查重规则：
                        │ 去重/合并/改类型/    │  dry-run 预览，--apply 执行
                        │ 改标签/标记冲突      │
                        └─────────┬───────────┘
                                   ▼
              ┌──────────────────────────────────────┐
              │ 本地记忆库 ~/.folio（唯一真相源）   │
              │ memory/<type>/*.md + MEMORY.md 索引   │
              │ state/ 同步状态  cache/ 搜索索引       │
              └─────────┬───────────────────┬────────┘
                        │ ③ 服务             │ 检索/管理
                        ▼                   ▼
              folio serve          folio CLI
              （stdio MCP server）     list/search/show/stats/
              5 个工具 + 1 个资源       organize/conflicts/doctor
```

## 环境要求

- Node.js ≥ 18（开发构建同样适用）
- pnpm 9（仓库锁定 `pnpm@9.15.4`，可用 `corepack enable` 自动准备）

## 快速开始

```bash
# 构建（monorepo：core / cli / mcp-server 三个包）
pnpm install
pnpm -r build

# 安装 CLI 到全局（二选一）
npm i -g packages/cli        # 或者：cd packages/cli && pnpm link --global

# 四步走
folio init                # ① 初始化 ~/.folio（目录结构 + 默认 config.toml）
folio sync                # ② 从检测到的 harness 增量导入记忆
folio organize            # ③ 整理：dry-run 预览（无 API key 时走本地查重规则）
folio install --all       # ④ 把 folio MCP server 注册进各家 harness 配置
```

`install` 默认只面向**已检测到**的 harness，`--all` 面向全部 5 家；写入前会自动备份原配置（`<文件>.bak-<时间戳>`），`folio uninstall` 可移除注册。

不全局安装也可以直接用 `node packages/cli/dist/cli.js <命令>`。

## 命令参考

全局选项：`--home <dir>`（优先级高于 `FOLIO_HOME`，默认 `~/.folio`）、`--json`（机器可读输出）、`-V/--version`。用法错误退出码 2，运行错误退出码 1。

| 命令 | 作用 | 常用选项 |
| --- | --- | --- |
| `init` | 初始化主目录（幂等） | — |
| `sync` | 从各 harness 收集记忆并增量同步 | `--adapter <id>`（可多次）、`--project-dir <dir>`（可多次）、`--classify`（同步时调 LLM 分类新记忆） |
| `watch` | 监听各记忆源目录，去抖后自动增量同步 | `--debounce <ms>`（默认 2000） |
| `list` | 列出记忆 | `--type`、`--scope`、`--limit`、`--archived` |
| `search <query>` | 全文检索（支持中文） | `--type`、`--scope`、`--limit` |
| `show <id>` | 显示一条记忆的完整 frontmatter 与正文（支持 id 唯一前缀） | — |
| `organize` | 整理：合并重复、改类型/标签、标记冲突（默认 dry-run） | `--apply`、`--batch-size <n>` |
| `conflicts` | 列出标记了 `conflictsWith` 的冲突记忆对 | — |
| `serve` | 以 stdio 启动 MCP server（stdout 为协议通道） | — |
| `install` | 把 MCP server 注册进各 harness 配置（写前备份） | `--adapter <id>`、`--all`、`--command "<cmd>"` |
| `uninstall` | 从各 harness 配置移除注册（写前备份） | `--adapter <id>`、`--all` |
| `doctor` | 体检：主目录/配置/适配器/记忆库/搜索索引 | `--check-llm`（额外真实探测 LLM 连通性） |
| `stats` | 按类型/作用域/来源 harness 分组统计 | — |

## 配置文件 `~/.folio/config.toml`

`init` 生成的默认配置；环境变量优先级高于文件。

```toml
[llm]
enabled = true                          # LLM 辅助能力总开关（分类、整理）
# apiKey = "sk-..."                     # 建议用环境变量 FOLIO_LLM_API_KEY 代替
baseURL = "https://api.openai.com/v1"   # OpenAI 兼容接口
model = "gpt-4o-mini"
classifyOnSync = false                  # sync 时是否自动调 LLM 给新记忆分类

[sync]
autoOrganize = false                    # 同步完成后是否自动整理

# 各适配器开关，缺省视为启用
# [adapters.claude-code]
# enabled = false
```

环境变量：

| 变量 | 作用 |
| --- | --- |
| `FOLIO_HOME` | 记忆库主目录（默认 `~/.folio`） |
| `FOLIO_LLM_API_KEY` / `FOLIO_LLM_BASE_URL` / `FOLIO_LLM_MODEL` | 覆盖 `[llm]` 对应字段 |
| `CLAUDE_CONFIG_DIR` / `CODEX_HOME` / `FOLIO_CURSOR_HOME` / `KIMI_CODE_HOME` / `FOLIO_ZCODE_HOME` | 覆盖各 harness 的 home 目录（默认 `~/.claude` 等） |

LLM 仅用于两件事：`sync --classify` 的新记忆分类、`organize` 的整理计划生成。未配置 API key 时全部功能可用，`organize` 自动退化为本地查重规则。

## 适配器支持矩阵

| harness | 导入什么 | MCP 注册到哪 | 备注 |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/CLAUDE.md`（全局指令）；`~/.claude/rules/**/*.md`；`~/.claude/projects/<proj>/memory/**/*.md` | `~/.claude.json` 顶层 `mcpServers` | 跳过 `MEMORY.md` 索引；项目目录名按 `-`→`/` 解码为路径；frontmatter `type` 生效 |
| Codex | `~/.codex/AGENTS.md`；`~/.codex/memories/**/*.md` | `$CODEX_HOME/config.toml` 顶层 `mcp_servers`（TOML） | **`memories_extensions/`（屏幕上下文，敏感）绝不收集**；frontmatter `project` 决定项目级 scope |
| Cursor | `~/.cursor/rules/**/*.{md,mdc}`；`<项目>/.cursor/rules/**/*.mdc` | `~/.cursor/mcp.json` 顶层 `mcpServers` | 项目 rules 仅 `.mdc`；frontmatter 的 `description/globs/alwaysApply` 存入 metadata |
| Kimi Code | `~/.kimi-code/AGENTS.md`；`~/.kimi-code/memories/**/*.md` | `~/.kimi-code/mcp.json` 顶层 `mcpServers` | 跳过 `MEMORY.md`；`memories/<proj>/` 下的归为项目级 |
| ZCode | `~/.zcode/AGENTS.md`；`~/.zcode/cli/memories/projects/<proj>/memory/**/*.md`；`~/.zcode/agent-memory/**` 与 `<项目>/.zcode/agent-memory/**` | `~/.zcode/cli/config.json` **嵌套** `mcp.servers` | 跳过 `MEMORY.md`；MCP servers 在嵌套键而非顶层 |

所有适配器对 harness 目录**只读**；会话记录（sessions/history 等）一律不碰。`sync` 会自动把当前工作目录（及 `--project-dir`）纳入项目级规则扫描。

## 记忆文件格式

每条记忆是 `~/.folio/memory/<type>/` 下的一个 Markdown 文件：

```markdown
---
id: m_abc123def456
type: feedback                # user | feedback | project | reference
scope: project:/path/to/proj  # global 或 project:<项目标识>
title: 测试前先构建
tags: [测试, 构建]
source:
  harness: claude-code        # 来源 harness（MCP 写入为 mcp）
  path: /original/source.md   # 原始文件路径（可选）
  importedAt: 2026-09-29T12:00:00.000Z
hash: <正文 sha256>            # 增量同步与去重的依据
created: 2026-09-29T12:00:00.000Z
updated: 2026-09-29T12:00:00.000Z
supersedes: [m_xxx]           # 可选：本条取代的记忆 id
conflictsWith: [m_yyy]        # 可选：与本条冲突的记忆 id
archived: false               # 可选：合并后归档到 archive/
---

正文（Markdown）。
```

`MEMORY.md`（记忆库索引）由 folio 自动重建，请勿手改。

## MCP server

`folio serve` 以 stdio 启动，提供 5 个工具 + 1 个资源：

- 工具：`memory_search`、`memory_list`、`memory_read`、`memory_write`、`memory_update`
- 资源：`memory://index`（记忆库索引 MEMORY.md 的当前内容）

`folio install` 注册的默认启动命令是 `folio serve`，可用 `--command "node /abs/path/cli.js"` 自定义。

## 隐私

- 一切数据都在本地文件系统，没有任何遥测。
- 唯一的网络出口是**你自己配置**的 LLM API（`sync --classify` / `organize` / `doctor --check-llm` 时才会发起请求）。

## Docker 端到端测试

仓库自带全链路验证镜像（不会往宿主机安装任何 harness）：

```bash
docker build -f docker/Dockerfile -t folio-e2e .   # 构建期完成 pnpm install / build / 全量单测
docker run --rm folio-e2e                          # 容器内跑 init→sync→检索→install→MCP 冒烟
```

镜像会全局安装真实 harness CLI（`@anthropic-ai/claude-code`、`@openai/codex`、`@moonshot-ai/kimi-code`，仅验证可安装性，不登录不运行）；Cursor / ZCode 没有 headless 安装方式，由 `docker/e2e.sh` 按文档布局伪造其 home 目录。任何一步断言失败即非零退出。

注：`@moonshot-ai/kimi-code` 的运行时需要 Node ≥ 22.5（用了 `node:zlib` 的 `createZstdDecompress`），在 node:20 基座上只能完成安装验证、`--version` 会报错，构建报告会如实标注 `installed-but-run-failed`，属预期行为，不影响其余验证。

## 桌面端（开发中）

`packages/desktop`（`@folio/desktop`）是 folio 的 Electron 桌面端，渲染层 1:1 移植自 `gui-mock/` 设计原型（Vite + React 18 + Tailwind 3 + shadcn），数据全部由 `@folio/core` 经 IPC 真实产出。

功能：记忆库文件树浏览 / 搜索（⌘K）/ 阅读与编辑 / 新建 / 归档 / Finder 定位、MEMORY.md 索引页、来源页（适配器检测状态 + MCP 注册/注销）、整理页（LLM 计划逐条确认后应用）、活动页（同步日志）、设置页（LLM 端点/模型/Key、适配器开关）、sidebar 手动同步 + watch 自动同步开关。

```bash
pnpm --filter @folio/desktop dev     # 开发模式（electron-vite dev，HMR）
pnpm --filter @folio/desktop build   # 产物到 out/{main,preload,renderer}
pnpm --filter @folio/desktop start   # 预览已构建产物
pnpm --filter @folio/desktop test    # services 单测（vitest，不需要显示器）
```

开发期可用 `FOLIO_HOME=/tmp/xxx pnpm --filter @folio/desktop dev` 指向临时记忆库，不动真实 `~/.folio`。无 Electron 环境时，`out/renderer` 是纯静态站（mock 数据兜底），任意静态服务器托管即可预览 UI。

**Node 18 宿主机注意**：electron 44 的 `install.js`（下载二进制的 postinstall）链路上 `@electron/get` v5 要求 Node ≥22，Node 18 下 `pnpm install` 会跳过二进制下载。需要真跑 Electron 时手动补齐（一次性）：

```bash
curl -sL https://github.com/electron/electron/releases/download/v44.4.5/electron-v44.4.5-darwin-arm64.zip -o /tmp/e.zip
unzip -q -o /tmp/e.zip -d packages/desktop/node_modules/electron/dist
echo "Electron.app" > packages/desktop/node_modules/electron/path.txt
```

安全基线（逐条落实，改这里要先看 `packages/desktop/src/main/`）：

1. `webPreferences` 显式 `contextIsolation: true` / `sandbox: true` / `nodeIntegration: false` / `webSecurity: true`；preload 打包为单文件 CJS（sandbox 硬性要求）。
2. 严格 CSP 按 mode 注入（`electron.vite.config.ts` 的 `transformIndexHtml`）：prod `default-src 'self'`、`connect-src 'none'`；dev 仅额外放宽 HMR 必需的 `connect-src 'self' ws: http://localhost:*` 与 `script-src 'unsafe-inline'`。
3. `setPermissionRequestHandler` / `setPermissionCheckHandler` 默认全拒。
4. `will-navigate` 一律 prevent、`setWindowOpenHandler` 一律 deny。
5. 所有 `ipcMain.handle` 先校验 `event.senderFrame.origin`（dev 只认 vite dev server origin，prod 只认 `file://`）。
6. 全部 IPC 载荷在 main 入口过 zod schema（`src/shared/ipc.ts` 三方共享）。
7. `contextBridge` 只暴露窄函数 + 纯数据，不暴露 `ipcRenderer` 本体；订阅类 API 返回 unsubscribe。
8. 零遥测：不调 `crashReporter.start()`，无任何 analytics。
9. LLM API Key 只走 `safeStorage` 加密落 `state/secrets.json`；`settings:get` 只回 `hasApiKey` + 掩码，明文既不进 `config.toml` 也不下发渲染层。
10. 不引入 remote 模块；窗口关闭即置 null 引用，`webContents` 销毁后不再 send。

## 路线图

- 第二批适配器：Gemini CLI、Qwen Code、Trae、CodeBuddy、OpenCode
- 遗留工具导入：Roo、Continue、iFlow
- 本地 REST API（绑定 127.0.0.1 + token 鉴权）
- Go 后端（单二进制分发）
- Electron 桌面端：首个版本已落地（见「桌面端（开发中）」），后续打包分发与自动更新

## 仓库结构

```
packages/
  core/        # 适配器、记忆库、同步、搜索、整理、LLM（冻结公共 API 见 src/index.ts）
  cli/         # folio CLI（commander）
  mcp-server/  # stdio MCP server（5 工具 + 1 资源）
  desktop/     # Electron 桌面端（开发中；渲染层移植自 gui-mock/）
docker/        # Dockerfile + e2e.sh（容器化端到端验证）
assets/        # logo 与图标（README 头部、桌面端窗口图标）
gui-mock/      # 设计原型（Vite + React 静态 mock，非产品代码）
```
