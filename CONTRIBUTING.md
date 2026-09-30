# Contributing

Thanks for your interest in contributing to folio. Please read `AGENTS.md` first — it documents the repository layout, hard constraints (Node 18 compatibility, ESM, frozen core API, read-only adapters, desktop security baseline), and testing conventions that all contributions must follow.

## Requirements

- Node.js ≥ 18
- pnpm 9 (the repo pins `pnpm@9.15.4`; run `corepack enable` to prepare it automatically)

## Build and test

```bash
pnpm install
pnpm -r build    # tsup for core/cli/mcp-server; electron-vite build for desktop
pnpm test        # vitest run across all 4 packages
```

End-to-end verification (required after touching adapters, `install`, or `serve`):

```bash
docker build -f docker/Dockerfile -t folio-e2e .
docker run --rm folio-e2e
```

## Contributing an adapter

The adapter contract (`HarnessAdapter`) and the full step-by-step checklist for adding a new harness adapter live in `AGENTS.md` (sections "适配器契约" and "新增适配器步骤"). In short: implement the contract in `packages/core/src/adapters/<id>.ts`, register it in the adapter index, add fixtures and tests, update the watch resolvers if applicable, extend `docker/e2e.sh`, and update the README adapter matrix together with `AGENTS.md`. Adapters are strictly read-only against harness directories.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, optionally scoped (e.g. `feat(adapters): add gemini-cli adapter`).
- Keep PRs focused; one concern per PR.
- Before submitting: `pnpm -r build` and `pnpm test` must pass. If your change touches adapters, `install`, or `serve`, also run the Docker e2e suite.
- If your change alters anything documented in `AGENTS.md` (public API, adapter list, security baseline), update `AGENTS.md` in the same PR.

## Code of conduct

Be respectful and constructive; harassment or disrespectful behavior of any kind is not tolerated.
