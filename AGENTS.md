# Agent guide — Streamclone Pulse extension

Chrome MV3 extension. Backend, migrations, and `pulse-core` live in the sibling **streamclone** checkout (`../twitch-7tv-clone` on disk; **streamclone** folder in multi-root workspace).

## Cursor vs generic agents

| Layer | Path | Role |
|-------|------|------|
| **This file** | `AGENTS.md` | Repo router — requirements, commands, cross-repo wiring (works in Cursor, Codex, etc.) |
| **Cursor rules** | `.cursor/rules/streamclone.mdc` | Always-on Pulse/StreamPulse guardrails |
| **Cursor skills** | `.cursor/skills/*/` | Reusable workflows (`coverage-triage`, `streamclone-task-runner`, …) |
| **Cursor subagents** | `.cursor/agents/` | Three reviewers: backend-safety, frontend-ux, ops-diagnostics |
| **Cursor hooks** | `.cursor/hooks.json` | Lightweight lint/secret guards — not full test suites |

Do not duplicate guardrails across `AGENTS.md` and `.cursor/rules/`; keep product truth in docs, routing here, Cursor-specific behavior under `.cursor/`.

## Read first (this repo)

| Task | Doc |
|------|-----|
| **Live coverage / VOD backfill / Protect** | [`docs/pulse-extension/live-coverage-requirements.md`](docs/pulse-extension/live-coverage-requirements.md) |
| Requirements R1–R12 | [`docs/pulse-extension/requirements.md`](docs/pulse-extension/requirements.md) |
| Architecture, API, schema | [`docs/pulse-extension/design.md`](docs/pulse-extension/design.md) |
| Task ledger (P0–P6) | [`docs/pulse-extension/tasks.md`](docs/pulse-extension/tasks.md) |
| **Figma UI (PNG + node IDs)** | [`docs/pulse-extension/figma-handoff.md`](docs/pulse-extension/figma-handoff.md) + [`figma/`](docs/pulse-extension/figma/) |
| Repo wiring | [`docs/CONTEXT.md`](docs/CONTEXT.md) |
| Extension code | `src/` |

## StreamPulse website / portal task router

For StreamPulse public website and portal work (the `streampulse.stream` site, **not** the extension overlay):

1. Read [`docs/pulse-extension/website-portal-requirements.md`](docs/pulse-extension/website-portal-requirements.md) for product requirements.
2. Read [`docs/website-portal/design.md`](docs/website-portal/design.md) for architecture and implementation constraints.
3. Execute from [`docs/website-portal/tasks.md`](docs/website-portal/tasks.md) in task-ID order (start with the "Recommended first implementation batch").

Hard guardrails:

- Do not store rollups / raw chat / VOD chat / TwitchTracker / corpus data in D1.
- Do not expose unauthenticated `/watch`.
- Do not expose Grafana / admin publicly.
- Do not require Twitch OAuth for MVP.
- Do not compute Pulse scores client-side.
- Do not fetch full-stream timelines (or Layer 2 analytics) during normal live polling.
- Use backend peaks, coverage, sync, and backfill states as the source of truth.
- Portal analytics must be sanitized **server-side** (`/v1/portal/analytics/*`), not by client-only stripping.

## Rules

- **Content scripts:** `chrome.runtime.sendMessage` only — no `fetch`.
- **Service worker:** all HTTP to Streamclone (`/v1/extension/*`, `/v1/analytics/.../watch`).
- Default backend: `http://localhost:8090` (Caddy in streamclone).
- New Go APIs → implement in streamclone `internal/analytics`, not here.

## Commands

```bash
npm run build      # dist/ for Load unpacked
npm run typecheck
npm test
```

Stack: `make up` in streamclone → `curl http://localhost:8090/v1/extension/health`.
