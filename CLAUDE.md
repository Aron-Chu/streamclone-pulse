# Streamclone Pulse — Claude Code

Chrome MV3 extension + StreamPulse portal. **StreamPulse backend** (Go BFF, packages, pulse skills) lives in sibling **`../streampulse-backend`**. Public Streamclone (`../twitch-7tv-clone`) is the desktop watch stack only.

## Claude Code setup (analytics / charts)

Project skills live under [`.claude/skills/`](.claude/skills/). First-time checklist: [`.claude/FIRST-RUN.md`](.claude/FIRST-RUN.md).

| Skill | Slash | Use |
|-------|-------|-----|
| Launch portal | `/run-streampulse-web` | Install + `npm run dev:hosted` + verify URLs |
| Chart work (primary) | `/adaptive-analytics-chart` | Cash App–style rest↔detail adaptive chart |
| Hub IA audit (secondary) | `/analytics-hub-audit` | Live Wire / Moments / rail only if needed |

**Phase 1 prompts (use both):**

- Chart: [`.claude/prompts/phase1-adaptive-chart-audit.md`](.claude/prompts/phase1-adaptive-chart-audit.md)
- Hub IA: [`.claude/prompts/phase1-hub-audit.md`](.claude/prompts/phase1-hub-audit.md)
- Orchestrator: [`.claude/prompts/phase1-both.md`](.claude/prompts/phase1-both.md)

**Browser:** install Chrome DevTools MCP plugin only (see FIRST-RUN). Prefer **Opus 5** when available.

**Portal URL:** `http://127.0.0.1:5173/analytics` → hosted `https://api.streampulse.stream`. Never use Streamclone `:8090` as portal BFF.

Cursor-oriented UX skills remain under `.cursor/skills/` — Claude Code does not load those automatically; use `.claude/skills/` for Claude Code workflows.

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
- Portal skills (Cursor): `.cursor/skills/`
- Portal skills (Claude Code): `.claude/skills/`

Pulse backend skills live in **`../streampulse-backend/.cursor/skills/pulse/`**.

## Read first

| Task | Doc |
|------|-----|
| Live coverage / backfill | [`docs/pulse-extension/live-coverage-requirements.md`](docs/pulse-extension/live-coverage-requirements.md) |
| Portal | [`docs/website-portal/design.md`](docs/website-portal/design.md) |
| Hub layout / Live Wire / Moments | [`docs/website-portal/analytics-command-center-layout.md`](docs/website-portal/analytics-command-center-layout.md) |
| Local portal dev | [`docs/website-portal/local-dev-runbook.md`](docs/website-portal/local-dev-runbook.md) |
| Backend router | [`../streampulse-backend/AGENTS.md`](../streampulse-backend/AGENTS.md) |
| Extension/portal router | [`AGENTS.md`](AGENTS.md) |

## Guardrails

Same as Cursor [`.cursor/rules/streamclone.mdc`](.cursor/rules/streamclone.mdc): no raw chat to clients, no client-side Pulse scoring, portal uses hosted API by default, **Go API changes go in streampulse-backend** not public Streamclone.

Local BFF debugging: **streampulse-backend** compose (`:8081`), not Streamclone `:8090`.
