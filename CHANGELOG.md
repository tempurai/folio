# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-06

### Added

- Incremental sync engine (`folio sync` / `watch`): one-way import from harness native stores into the local `~/.folio` memory bank, with hash-based change detection and a persistent sync state.
- Five harness adapters: Claude Code, Codex, Cursor, Kimi Code, ZCode — strictly read-only, with per-adapter home directory env overrides.
- LLM-assisted organize (`folio organize`): merge duplicates, retype/retag, flag conflicts via an OpenAI-compatible API, with a local dedup-rules fallback when no API key is configured.
- stdio MCP server (`folio serve`): 5 tools (`memory_search`, `memory_list`, `memory_read`, `memory_write`, `memory_update`) plus the `memory://index` resource; `install`/`uninstall` register it into each harness's config with timestamped backups.
- `folio` CLI with 13 commands: `init`, `sync`, `watch`, `list`, `search`, `show`, `organize`, `conflicts`, `serve`, `install`, `uninstall`, `doctor`, `stats`.
- Electron desktop app (in development): file-tree browsing, ⌘K search, editing, organize review, sources/activity/settings pages, with a hardened main-process security baseline.
- Project logo and icon set (`assets/`).
- Docker end-to-end verification image (`docker/`): full init→sync→search→install→MCP smoke pipeline with real harness CLIs installed in-container.
