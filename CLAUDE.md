# Streamclone Pulse — Claude Code

Chrome MV3 extension + StreamPulse portal. **StreamPulse backend** (Go BFF, pulse skills) lives in sibling **`../streampulse-backend`**. Public `@streampulse/*` packages live in this repo under `packages/`. Public Streamclone (`../twitch-7tv-clone`) is the desktop watch stack only.

## Run Claude Code from streampulse-backend (backend work)

```powershell
cd ..\streampulse-backend
# TODO: make claude-setup when MCP/skills land here
claude
```

For extension/portal-only work, run from this repo (`streamclone-pulse`).

## This checkout owns

- Extension spec: [`docs/pulse-extension/`](docs/pulse-extension/)
- Portal guardrails: [`docs/website-portal/design.md`](docs/website-portal/design.md)
- Portal skills: `.cursor/skills/` (UX workflows)

Pulse backend skills live in **`../streampulse-backend/.cursor/skills/pulse/`**.

## Read first

| Task | Doc |
|------|-----|
| Live coverage / backfill | [`docs/pulse-extension/live-coverage-requirements.md`](docs/pulse-extension/live-coverage-requirements.md) |
| Portal | [`docs/website-portal/design.md`](docs/website-portal/design.md) |
| Backend router | [`../streampulse-backend/AGENTS.md`](../streampulse-backend/AGENTS.md) |
| Extension/portal router | [`AGENTS.md`](AGENTS.md) |

## Guardrails

Same as Cursor [`.cursor/rules/streamclone.mdc`](.cursor/rules/streamclone.mdc): no raw chat to clients, no client-side Pulse scoring, portal uses hosted API by default, **Go API changes go in streampulse-backend** not public Streamclone.

Local BFF debugging: **streampulse-backend** compose (`:8081`), not Streamclone `:8090`.

## Git rules (every session)

- Never force-push or rewrite pushed history.
- Commits follow [`AGENTS.md` § Commits](AGENTS.md#commits-agents): author `Aron-Chu <aroncloudchu@gmail.com>`, no `Co-authored-by:` or `Claude-Session:` trailers. `.claude/settings.json` turns Claude's trailers off.
- Keep Linear issue ids out of branch names, commit messages, PR titles and PR bodies.

## Cloud sessions (Claude Code on the web, Codex cloud)

A cloud session is a fresh clone: no sibling repos, no local stack, no Chrome. `scripts/cloud-setup.sh` installs dependencies (Claude: the SessionStart hook in `.claude/settings.json`; Codex: `bash scripts/cloud-setup.sh --cloud` as the environment's setup script).

- Checks to run: `npm test`, `npm run typecheck`, `npm run build`; portal: `cd streampulse-web && npm test && npm run typecheck && npm run check:analytics-overlap`. After editing `packages/*/src`, run `npm run build:packages` first.
- Do not run Playwright, e2e or visual baselines, and do not claim an extension reload. Those need Aron's machine; list what you could not run in the PR.
- Push only your own branch and open a **draft** PR. Never merge, mark ready, enable auto-merge, deploy, publish to a store, or touch production.
- Public repo: no secrets, host IPs, private hostnames or operator topology in code, commits, PRs or logs.
