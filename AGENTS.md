# AGENTS.md

面向在本仓库工作的 coding agent 的指南。先读完本文件再动手。

## 仓库结构

pnpm monorepo（`pnpm-workspace.yaml`：`packages/*`），TypeScript + ESM（所有包 `"type": "module"`）。

```
packages/
  core/          @folio/core —— 领域核心，无 CLI 依赖
    src/adapters/    5 个 harness 适配器（claude-code/codex/cursor/kimi-code/zcode）
    src/config.ts    config.toml 读写（loadConfig：zod 校验 + env 覆盖；saveConfig/patchConfig 原子写回）
    src/model.ts     记忆数据模型、frontmatter 序列化、hash/id
    src/store.ts     MemoryStore：memory/<type>/*.md 的读写、归档、索引重建
    src/sync.ts      runSync：增量同步引擎（state/sync-state.json 记录 sourcePath→hash；摘要追加 state/activity.jsonl，readActivity 读取）
    src/search.ts    SearchIndex：内存倒排索引（英文小写 token + 汉字单字/二元组）
    src/organize.ts  整理：LLM 计划 + 本地查重兜底
    src/install.ts   installMcpServer/uninstallMcpServer：写各 harness MCP 配置（写前备份、读-改-写 JSON/TOML、--command 拆分）
    src/llm.ts       OpenAI 兼容客户端（原生 fetch，30s 超时，重试 2 次）
    src/paths.ts     FOLIO_HOME 解析（--home > FOLIO_HOME > ~/.folio）
    src/index.ts     冻结公共 API（见「硬约束」）
  cli/           folio-memory —— commander CLI，bin: dist/cli.js；npm 上唯一发布的包（core/mcp-server 与全部依赖经 tsup 打进单文件，发布包零运行时依赖）
  mcp-server/    @folio/mcp-server —— stdio MCP server（5 工具 + memory://index 资源）
  desktop/       @folio/desktop —— Electron 桌面端（开发中）
    src/shared/ipc.ts   IPC 契约：通道常量 + 请求/响应类型 + zod schemas（main/preload/renderer 三方共享，只许 import type 引 core）
    src/main/           index.ts（生命周期/权限/导航收口）、services.ts（纯逻辑层，不依赖 electron，注入 SecretCipher）、ipc.ts、watch.ts、secrets.ts（safeStorage）
    src/preload/        contextBridge 窄 API，打包为单文件 CJS（sandbox 要求）
    src/renderer/       从 gui-mock/ 1:1 移植的渲染层；data/provider.ts 选 window.folio ?? mockProvider
    test/               services 的 vitest 单测（fixtures 复制到临时目录，同 core 约定）
docker/          Dockerfile + e2e.sh：容器化端到端验证（唯一允许的 harness 安装环境）
assets/          logo 与图标（README 头部、桌面端窗口图标）
gui-mock/        设计原型（Vite + React 静态 mock，非产品代码；desktop 渲染层由此 1:1 移植）
```

## 构建与测试

```bash
pnpm install          # 锁定 pnpm@9.15.4（corepack enable 可自动准备）
pnpm -r build         # tsup，core 双入口（index + adapters/index），cli 带 shebang banner；desktop 走 electron-vite build
pnpm -r test          # vitest run ×4 包；cli 的 pretest 会先 build 自身与依赖，desktop 的 pretest 会先 build core
```

端到端验证（改完适配器 / install / serve 后必跑）：

```bash
docker build -f docker/Dockerfile -t folio-e2e .
docker run --rm folio-e2e
```

## 硬约束

1. **Node 18 兼容**：`engines.node >= 18`，tsup `target: node18`，`@types/node` 锁 18.x。**新增依赖前必须查其 `engines`**，凡是要求 Node ≥20 的一律不用（或锁到兼容旧版）。只用 Node 18 已有的 API（如全局 `fetch` 可用，`Array.prototype.toSorted` 不可用）。
2. **ESM**：源码内相对 import 必须带 `.js` 后缀；禁止引入 CommonJS-only 依赖。
3. **`@folio/core` 公共 API 冻结**：`packages/core/src/index.ts` 的导出清单对外冻结——cli、mcp-server 与未来的 Go/REST 层都依赖它。新增导出可以，**改名/删除/改语义必须全仓库同步并更新本文件**。注意 `sync.ts` 用静态 `import` 加载内置适配器（保证 cli 单文件打包可行），core 的 tsup 双入口（`src/index.ts` + `src/adapters/index.ts`）不能动。
4. **适配器只读**：`collect()` 只允许读 harness 目录，绝不写、改、删 harness 的任何文件。唯一的例外是 `install`/`uninstall` 命令对 MCP 配置文件的写入，且写前必须备份（`<文件>.bak-<时间戳>`）。敏感目录不碰：codex 的 `memories_extensions/`、各家的 sessions/history。
5. **不在宿主机安装 harness**：任何真实 harness CLI（claude/codex/kimi 等）只允许装进 Docker 镜像（见 `docker/Dockerfile`）。宿主机上调试一律用 `packages/core/test/fixtures/` 或临时目录伪造 home。
6. 命令 stdout 纪律：`serve` 的 stdout 是 MCP 协议通道，任何日志只能走 `console.error`；`--json` 模式下 stdout 只输出 JSON。
7. **desktop 安全基线**（详见 README「桌面端」一节，改动 `packages/desktop/src/main/` 前必读）：
   - preload 必须保持**单文件 CJS**（`sandbox: true` 要求）；preload/renderer 不得直接 import Node 内置模块或 `@folio/core` 运行时（renderer 对 core 只允许 `import type`）。
   - 所有 IPC 通道三件套缺一不可：`event.senderFrame.origin` 校验 + zod 载荷校验 + contextBridge 只传纯数据（不暴露 ipcRenderer 本体，订阅 API 必须返回 unsubscribe）。
   - LLM API Key 只许走 `safeStorage` 加密后的 `state/secrets.json`；严禁写进 config.toml、严禁明文下发渲染层（getSettings 只回 `hasApiKey` + 掩码）。
   - 窗口 webPreferences 四个开关（contextIsolation/sandbox/nodeIntegration/webSecurity）显式写出，不许删；零遥测，不调 `crashReporter.start()`。

## 适配器契约

```ts
interface HarnessAdapter {
  id: string;                 // 全小写短横线，如 'claude-code'
  name: string;               // 展示名，如 'Claude Code'
  detect(): Promise<boolean>; // 仅判断 home 目录存在性，不读内容
  collect(ctx: { projectDirs: string[] }): Promise<RawMemoryItem[]>;
  mcp?: McpIntegration;       // 通过 defineMcpIntegration 声明 configPath/format/serversPath
}
```

- `RawMemoryItem`：`{ harnessId, sourcePath, typeHint?, scope, title?, content, mtime, metadata? }`。`scope` 取 `global` 或 `project:<项目标识>`；`typeHint` 尽量从 frontmatter `type` 取（`typeHintFrom`），取不到按适配器语义给默认值。
- home 解析一律 `resolveHarnessHome('<ENV_VAR>', '.<默认目录>')`（env 优先），新增适配器要在 README 矩阵、`watch` 命令的 `HARNESS_HOME_RESOLVERS`（如适用）和本文件中登记该 env。
- 复用 `adapters/utils.ts`：`walkMarkdown`（递归收 markdown，支持扩展名与 skip 回调）、`tryReadMarkdownItem`（容错读 frontmatter）、`deriveTitle`（title/name → 文件名 stem）、`listSubdirs`、`decodeProjectDirName`。
- 索引文件（`MEMORY.md`）按各家惯例 skip，不导入。

## 新增适配器步骤

1. `packages/core/src/adapters/<id>.ts`：实现契约，mcp 用 `defineMcpIntegration`。
2. `packages/core/src/adapters/index.ts`：注册进 `adapters` 数组并 re-export。
3. fixtures：`packages/core/test/fixtures/adapters/<id>/`（含 AGENTS/CLAUDE.md、规则、memory、需跳过的文件各一份）。
4. `packages/core/test/adapters.test.ts`：补 detect/collect/mcp 用例（env 指到 fixtures）。
5. `packages/cli/src/commands/sync.ts` 的 `HARNESS_HOME_RESOLVERS`：如 watch 需要监听该 home，补解析器。
6. `docker/e2e.sh`：播种该 harness 的伪造 home + 更新计数断言。
7. `README.md` 适配器矩阵加一行；本文件同步。

## 测试约定

- **fixtures 驱动**：适配器测试把 5 个 env（`CLAUDE_CONFIG_DIR` 等）指到 `packages/core/test/fixtures/adapters/`，`beforeEach` 存、`afterEach` 还原；绝不动真实 home。
- **临时记忆库**：store/sync/mcp 测试用 `mkdtempSync(join(tmpdir(), ...))` 当 `FOLIO_HOME`/`home`，用后 `rmSync`。
- **不起真 stdio**：mcp-server 测试用 `InMemoryTransport.createLinkedPair()` + 官方 Client 直连 `createMcpServer`，不 spawn 子进程；真 stdio 链路只由 `docker/e2e.sh` 的冒烟脚本覆盖。
- **LLM 测试不起真请求**：用本地 127.0.0.1 HTTP stub（见 `sync.test.ts` 的 classify 用例）。
- CLI 测试通过 `createProgram()` 进程内调用（见 `cli.test.ts`），退出码用 `exitOverride` 断言。
- **桌面端 UI 冒烟**（需显示器，不进 `pnpm test`）：`pnpm --filter @folio/desktop ui-smoke` —— playwright-core 驱动真实 Electron 窗口，全程临时目录 + fixtures，截图落在 `$TMPDIR/folio-ui-smoke/shots`。宿主机 Node 18 下 Electron 二进制需手动补齐（见 README「桌面端」一节）。

## 风格

- 用户可见输出（CLI、错误消息）一律中文；代码标识符英文；注释只写"为什么"，简体中文。
- 不引新依赖除非必要；表格、TOML 等已手搓/选型（`renderTable`、`smol-toml`），不要重复造。
- zod 做一切外部数据校验（config、frontmatter、LLM 响应、sync-state）；损坏数据降级而非崩溃（如 frontmatter 损坏当正文、sync-state 损坏从空状态重来并报错提示）。
