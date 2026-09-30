# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for security vulnerabilities. Report them via [GitHub private security advisories](https://github.com/tempurai/folio/security/advisories/new). If that channel is unavailable to you, open an issue with minimal detail and ask for a private contact.

We aim to acknowledge reports within 72 hours.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x (latest) | ✅ |
| < 0.1.0 | ❌ |

## Data sensitivity notes

folio handles data that can be personal or sensitive. When reviewing or contributing, keep these properties in mind:

- **Local memory bank**: everything lives under `~/.folio` on the local filesystem. There is no telemetry and no network egress except the LLM API you configure yourself.
- **LLM API keys**: the desktop app stores the key only as `safeStorage`-encrypted `state/secrets.json`; plaintext keys must never land in `config.toml`, logs, or the renderer process. The CLI reads keys only from `config.toml` or environment variables — never commit a real key.
- **Read-only adapters**: adapters only read from harness directories and never write, modify, or delete anything there (the sole exception is `install`/`uninstall` writing MCP config, always with a timestamped backup). Sensitive stores such as Codex's `memories_extensions/` and all session/history directories are deliberately never collected.
