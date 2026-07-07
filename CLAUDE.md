# Streamclone Pulse — Claude Code

Chrome MV3 extension + StreamPulse portal. **Backend, MCP, and codegraph for Go live in the sibling Streamclone checkout** (`../twitch-7tv-clone` on disk).

## Run Claude Code from Streamclone root

```powershell
cd ..\twitch-7tv-clone
make claude-setup
claude
```

Project MCP, skills, and reviewers are configured in the **streamclone** repo. This checkout adds:

- Extension spec: [`docs/pulse-extension/`](docs/pulse-extension/)
- Portal guardrails: [`docs/website-portal/design.md`](docs/website-portal/design.md)
- Portal skills (synced into streamclone): `.cursor/skills/` → `../twitch-7tv-clone/.claude/skills/pulse/`

## Read first

| Task | Doc |
|------|-----|
| Live coverage / backfill | [`docs/pulse-extension/live-coverage-requirements.md`](docs/pulse-extension/live-coverage-requirements.md) |
| Portal | [`docs/website-portal/design.md`](docs/website-portal/design.md) |
| Hosted production / image promotion | streamclone [`production-promotion-contract.md`](../twitch-7tv-clone/docs/production-promotion-contract.md), [image exit audit](docs/pulse-extension/evidence/streamclone-image-exit-audit-2026-07.md) |
| Router | [`AGENTS.md`](AGENTS.md) |

## Guardrails

Same as Cursor [`.cursor/rules/streamclone.mdc`](.cursor/rules/streamclone.mdc): no raw chat to clients, no client-side Pulse scoring, portal uses hosted API by default, backend changes go in **streamclone** not here.

Full Claude setup: sibling [`../twitch-7tv-clone/docs/CLAUDE.md`](../twitch-7tv-clone/docs/CLAUDE.md).
