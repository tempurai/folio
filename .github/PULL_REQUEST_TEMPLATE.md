## Summary

<!-- What does this PR change and why? -->

## Checklist

- [ ] `pnpm -r build` passes
- [ ] `pnpm test` passes
- [ ] Docker e2e passes (`docker build -f docker/Dockerfile -t tememory-e2e . && docker run --rm tememory-e2e`) — required if this touches adapters, `install`, or `serve`
- [ ] `AGENTS.md` updated if the change affects anything it documents (public API, adapter list, constraints, security baseline)
- [ ] No new dependencies requiring Node > 18 (checked `engines` of any added package)
- [ ] No secrets, API keys, or local absolute paths committed
