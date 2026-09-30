<p align="center"><img src="assets/icons/icon-256.png" width="96" alt="tememory logo"></p>

**English** | [中文](README.zh-CN.md)

# tememory

A personal memory hub that unifies memories across AI coding harnesses (Claude Code, Codex, Cursor, Kimi Code, ZCode).

Every harness keeps its own memory/rules store, in incompatible formats that never talk to each other. tememory **one-way imports** those scattered memories into a local file-based memory bank (`~/.tememory`) with a unified format and unified search, then **serves the bank back** over an MCP server so any MCP-capable harness can read all of it.

## Three design principles

1. **One-way import**: only reads from each harness's native store and syncs incrementally into the memory bank; it **never writes back** to any harness's native directory. The bank is the single source of truth — a memory stays in the bank even after its source file is deleted.
2. **Unified format**: every memory is Markdown + frontmatter, in one of four types — `user` (user preferences), `feedback` (feedback and lessons learned), `project` (project state and decisions), `reference` (reference material).
3. **Serve back over MCP**: the bank is exposed to harnesses via `tememory serve` (a stdio MCP server); harnesses without MCP support are not integrated.

## Architecture

```
┌──────────────────── Harness native stores (read-only) ────────────────────┐
│ ~/.claude  ~/.codex  ~/.cursor  ~/.kimi-code  ~/.zcode  <project>/.*      │
└───────────────────────────────────┬───────────────────────────────────────┘
                                    │ ① import (adapters, incremental sync / watch)
                                    ▼
                        ┌───────────────────────┐
                        │ organize               │  LLM or local dedup rules:
                        │ dedup / merge / retype │  dry-run preview,
                        │ / retag / flag         │  --apply to execute
                        │ conflicts              │
                        └───────────┬───────────┘
                                    ▼
              ┌────────────────────────────────────────┐
              │ local memory bank ~/.tememory           │
              │ (single source of truth)                │
              │ memory/<type>/*.md + MEMORY.md index    │
              │ state/ sync state   cache/ search index │
              └─────────┬───────────────────┬──────────┘
                        │ ③ serve           │ browse/manage
                        ▼                   ▼
              tememory serve          tememory CLI
              (stdio MCP server)      list/search/show/stats/
              5 tools + 1 resource    organize/conflicts/doctor
```

## Requirements

- Node.js ≥ 18 (also for development builds)
- pnpm 9 (the repo pins `pnpm@9.15.4`; `corepack enable` prepares it automatically)

## Quick start

```bash
# Build (monorepo: core / cli / mcp-server)
pnpm install
pnpm -r build

# Install the CLI globally (pick one)
npm i -g packages/cli        # or: cd packages/cli && pnpm link --global

# Four steps
tememory init                # ① initialize ~/.tememory (directory layout + default config.toml)
tememory sync                # ② incrementally import memories from detected harnesses
tememory organize            # ③ organize: dry-run preview (falls back to local dedup rules without an API key)
tememory install --all       # ④ register the tememory MCP server into each harness's config
```

`install` targets only **detected** harnesses by default; `--all` targets all 5. The original config is backed up before every write (`<file>.bak-<timestamp>`), and `tememory uninstall` removes the registration.

Without a global install you can also run `node packages/cli/dist/cli.js <command>` directly.

## Command reference

Global options: `--home <dir>` (takes precedence over `TEMEMORY_HOME`, default `~/.tememory`), `--json` (machine-readable output), `-V/--version`. Exit code 2 for usage errors, 1 for runtime errors.

| Command | Purpose | Common options |
| --- | --- | --- |
| `init` | Initialize the home directory (idempotent) | — |
| `sync` | Collect memories from harnesses and sync incrementally | `--adapter <id>` (repeatable), `--project-dir <dir>` (repeatable), `--classify` (call the LLM to classify new memories during sync) |
| `watch` | Watch memory source directories; auto-sync after debounce | `--debounce <ms>` (default 2000) |
| `list` | List memories | `--type`, `--scope`, `--limit`, `--archived` |
| `search <query>` | Full-text search (Chinese supported) | `--type`, `--scope`, `--limit` |
| `show <id>` | Show a memory's full frontmatter and body (accepts a unique id prefix) | — |
| `organize` | Organize: merge duplicates, retype/retag, flag conflicts (dry-run by default) | `--apply`, `--batch-size <n>` |
| `conflicts` | List conflicting memory pairs flagged with `conflictsWith` | — |
| `serve` | Start the MCP server over stdio (stdout is the protocol channel) | — |
| `install` | Register the MCP server into harness configs (backup before write) | `--adapter <id>`, `--all`, `--command "<cmd>"` |
| `uninstall` | Remove the registration from harness configs (backup before write) | `--adapter <id>`, `--all` |
| `doctor` | Health check: home/config/adapters/memory bank/search index | `--check-llm` (additionally probes real LLM connectivity) |
| `stats` | Grouped stats by type/scope/source harness | — |

## Config file `~/.tememory/config.toml`

Default config generated by `init`; environment variables take precedence over the file.

```toml
[llm]
enabled = true                          # master switch for LLM-assisted features (classify, organize)
# apiKey = "sk-..."                     # prefer the TEMEMORY_LLM_API_KEY environment variable
baseURL = "https://api.openai.com/v1"   # OpenAI-compatible endpoint
model = "gpt-4o-mini"
classifyOnSync = false                  # whether sync auto-classifies new memories via the LLM

[sync]
autoOrganize = false                    # whether to auto-organize after sync completes

# Per-adapter switches; treated as enabled when omitted
# [adapters.claude-code]
# enabled = false
```

Environment variables:

| Variable | Purpose |
| --- | --- |
| `TEMEMORY_HOME` | Memory bank home directory (default `~/.tememory`) |
| `TEMEMORY_LLM_API_KEY` / `TEMEMORY_LLM_BASE_URL` / `TEMEMORY_LLM_MODEL` | Override the corresponding `[llm]` fields |
| `CLAUDE_CONFIG_DIR` / `CODEX_HOME` / `TEMEMORY_CURSOR_HOME` / `KIMI_CODE_HOME` / `TEMEMORY_ZCODE_HOME` | Override each harness's home directory (defaults `~/.claude`, etc.) |

The LLM is used for exactly two things: classifying new memories in `sync --classify`, and generating organize plans in `organize`. Everything works without an API key; `organize` automatically degrades to local dedup rules.

## Adapter support matrix

| Harness | What gets imported | Where the MCP server is registered | Notes |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/CLAUDE.md` (global instructions); `~/.claude/rules/**/*.md`; `~/.claude/projects/<proj>/memory/**/*.md` | top-level `mcpServers` in `~/.claude.json` | skips the `MEMORY.md` index; project directory names are decoded `-`→`/` into paths; frontmatter `type` is honored |
| Codex | `~/.codex/AGENTS.md`; `~/.codex/memories/**/*.md` | top-level `mcp_servers` (TOML) in `$CODEX_HOME/config.toml` | **`memories_extensions/` (screen context, sensitive) is never collected**; frontmatter `project` decides project-level scope |
| Cursor | `~/.cursor/rules/**/*.{md,mdc}`; `<project>/.cursor/rules/**/*.mdc` | top-level `mcpServers` in `~/.cursor/mcp.json` | project rules are `.mdc` only; frontmatter `description/globs/alwaysApply` is stored in metadata |
| Kimi Code | `~/.kimi-code/AGENTS.md`; `~/.kimi-code/memories/**/*.md` | top-level `mcpServers` in `~/.kimi-code/mcp.json` | skips `MEMORY.md`; entries under `memories/<proj>/` are treated as project-level |
| ZCode | `~/.zcode/AGENTS.md`; `~/.zcode/cli/memories/projects/<proj>/memory/**/*.md`; `~/.zcode/agent-memory/**` and `<project>/.zcode/agent-memory/**` | **nested** `mcp.servers` in `~/.zcode/cli/config.json` | skips `MEMORY.md`; MCP servers live under a nested key, not top-level |

All adapters are **read-only** against harness directories; session records (sessions/history, etc.) are never touched. `sync` automatically includes the current working directory (and any `--project-dir`) in the project-level rules scan.

## Memory file format

Each memory is a Markdown file under `~/.tememory/memory/<type>/`:

```markdown
---
id: m_abc123def456
type: feedback                # user | feedback | project | reference
scope: project:/path/to/proj  # global or project:<project identifier>
title: Build before testing
tags: [testing, build]
source:
  harness: claude-code        # source harness ("mcp" when written via MCP)
  path: /original/source.md   # original file path (optional)
  importedAt: 2026-09-29T12:00:00.000Z
hash: <body sha256>           # basis for incremental sync and dedup
created: 2026-09-29T12:00:00.000Z
updated: 2026-09-29T12:00:00.000Z
supersedes: [m_xxx]           # optional: ids this memory supersedes
conflictsWith: [m_yyy]        # optional: ids this memory conflicts with
archived: false               # optional: archived into archive/ after a merge
---

Body (Markdown).
```

`MEMORY.md` (the bank index) is rebuilt automatically by tememory — do not edit it by hand.

## MCP server

`tememory serve` starts over stdio and provides 5 tools + 1 resource:

- Tools: `memory_search`, `memory_list`, `memory_read`, `memory_write`, `memory_update`
- Resource: `memory://index` (current content of the bank index MEMORY.md)

The default launch command registered by `tememory install` is `tememory serve`; customize it with `--command "node /abs/path/cli.js"`.

## Privacy

- All data stays on the local filesystem; there is no telemetry of any kind.
- The only network egress is the LLM API **you configure yourself** (requests are made only by `sync --classify` / `organize` / `doctor --check-llm`).

## Docker end-to-end tests

The repo ships a full-pipeline verification image (it never installs any harness on your host):

```bash
docker build -f docker/Dockerfile -t tememory-e2e .   # build stage runs pnpm install / build / full unit tests
docker run --rm tememory-e2e                          # in-container: init → sync → search → install → MCP smoke
```

The image globally installs real harness CLIs (`@anthropic-ai/claude-code`, `@openai/codex`, `@moonshot-ai/kimi-code` — installability check only, no login, no runs); Cursor and ZCode have no headless install path, so `docker/e2e.sh` fakes their home directories per the documented layout. Any failed assertion exits non-zero.

Note: `@moonshot-ai/kimi-code` requires Node ≥ 22.5 at runtime (it uses `createZstdDecompress` from `node:zlib`), so on the node:20 base only the install check passes and `--version` fails; the build report marks it `installed-but-run-failed` as expected, without affecting the rest of the verification.

## Desktop app (in development)

`packages/desktop` (`@tememory/desktop`) is the Electron desktop app for tememory. The renderer is a 1:1 port of the `gui-mock/` design prototype (Vite + React 18 + Tailwind 3 + shadcn); all data is produced for real by `@tememory/core` over IPC.

Features: memory-bank file-tree browsing / search (⌘K) / reading & editing / create / archive / reveal in Finder, MEMORY.md index page, sources page (adapter detection status + MCP register/unregister), organize page (confirm each LLM plan item before applying), activity page (sync log), settings page (LLM endpoint/model/key, adapter toggles), sidebar manual sync + watch auto-sync toggle.

```bash
pnpm --filter @tememory/desktop dev     # development mode (electron-vite dev, HMR)
pnpm --filter @tememory/desktop build   # output to out/{main,preload,renderer}
pnpm --filter @tememory/desktop start   # preview the built output
pnpm --filter @tememory/desktop test    # services unit tests (vitest, no display needed)
```

During development, point at a temporary bank with `TEMEMORY_HOME=/tmp/xxx pnpm --filter @tememory/desktop dev` to avoid touching the real `~/.tememory`. Without an Electron environment, `out/renderer` is a plain static site (with mock-data fallback) — host it on any static server to preview the UI.

**Note for Node 18 hosts**: electron 44's `install.js` (the postinstall that downloads the binary) goes through `@electron/get` v5, which requires Node ≥ 22, so `pnpm install` under Node 18 skips the binary download. To actually run Electron, patch it in manually (one-time):

```bash
curl -sL https://github.com/electron/electron/releases/download/v44.4.5/electron-v44.4.5-darwin-arm64.zip -o /tmp/e.zip
unzip -q -o /tmp/e.zip -d packages/desktop/node_modules/electron/dist
echo "Electron.app" > packages/desktop/node_modules/electron/path.txt
```

Security baseline (enforced item by item — read `packages/desktop/src/main/` before changing any of this):

1. `webPreferences` explicitly sets `contextIsolation: true` / `sandbox: true` / `nodeIntegration: false` / `webSecurity: true`; the preload is bundled as a single-file CJS (a hard sandbox requirement).
2. Strict CSP injected per mode (`transformIndexHtml` in `electron.vite.config.ts`): prod `default-src 'self'`, `connect-src 'none'`; dev only additionally relaxes what HMR needs — `connect-src 'self' ws: http://localhost:*` and `script-src 'unsafe-inline'`.
3. `setPermissionRequestHandler` / `setPermissionCheckHandler` deny everything by default.
4. `will-navigate` is always prevented; `setWindowOpenHandler` always denies.
5. Every `ipcMain.handle` first validates `event.senderFrame.origin` (dev only accepts the vite dev-server origin, prod only `file://`).
6. All IPC payloads pass zod schemas at the main-process entry (`src/shared/ipc.ts`, shared by all three sides).
7. `contextBridge` exposes only narrow functions + plain data, never the raw `ipcRenderer`; subscription APIs return an unsubscribe function.
8. Zero telemetry: no `crashReporter.start()`, no analytics of any kind.
9. The LLM API key only ever lands in `state/secrets.json` encrypted via `safeStorage`; `settings:get` returns only `hasApiKey` + a mask — the plaintext never enters `config.toml` and is never sent to the renderer.
10. No remote module; the window reference is nulled on close, and nothing is sent after `webContents` is destroyed.

## Roadmap

- Second batch of adapters: Gemini CLI, Qwen Code, Trae, CodeBuddy, OpenCode
- Legacy tool imports: Roo, Continue, iFlow
- Local REST API (bound to 127.0.0.1 + token auth)
- Go backend (single-binary distribution)
- Electron desktop app: first version has landed (see "Desktop app (in development)"); packaging/distribution and auto-update are next

## Repository structure

```
packages/
  core/        # adapters, memory store, sync, search, organize, LLM (frozen public API in src/index.ts)
  cli/         # tememory CLI (commander)
  mcp-server/  # stdio MCP server (5 tools + 1 resource)
  desktop/     # Electron desktop app (in development; renderer ported from gui-mock/)
docker/        # Dockerfile + e2e.sh (containerized end-to-end verification)
assets/        # logo and icons (README header, desktop window icon)
gui-mock/      # design prototype (Vite + React static mock, not product code)
```
