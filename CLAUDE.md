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
