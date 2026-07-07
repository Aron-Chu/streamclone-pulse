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
| **Portal local dev (hosted-first)** | [`docs/website-portal/local-dev-runbook.md`](docs/website-portal/local-dev-runbook.md) |
| Extension code | `src/` |

## StreamPulse website / portal task router

For StreamPulse public website and portal work (the `streampulse.stream` site, **not** the extension overlay):

1. Read [`docs/pulse-extension/website-portal-requirements.md`](docs/pulse-extension/website-portal-requirements.md) for product requirements.
2. Read [`docs/website-portal/design.md`](docs/website-portal/design.md) for architecture and implementation constraints.
3. Read [`docs/website-portal/analytics-command-center-layout.md`](docs/website-portal/analytics-command-center-layout.md) for hub landing section order, Pulse Moments side-by-side layout, chart rail inspector, and layout anti-regressions (2026-07).
4. Execute from [`docs/website-portal/tasks.md`](docs/website-portal/tasks.md) in task-ID order (start with the "Recommended first implementation batch").

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
- **Extension** default backend: `https://api.streampulse.stream` (hosted). Local `http://localhost:8090` requires explicit opt-in in Options → Advanced.
- **StreamPulse portal** (`streampulse-web`): hosted API by default (`https://api.streampulse.stream`); `npm run dev:local` for explicit `:8090` only. See [`docs/website-portal/local-dev-runbook.md`](docs/website-portal/local-dev-runbook.md) before starting Vite (restart after branch switch; `npm install` for `@streamclone/*` links).
- New Go APIs → implement in streamclone `internal/analytics`, not here.
- ReplayForge / auto clipper work is not owned by the extension or portal. Use sibling streamclone [`docs/agents-streamclone-and-replayforge.md`](../twitch-7tv-clone/docs/agents-streamclone-and-replayforge.md): Streamclone owns candidates/triggers/callback state, ReplayForge owns render/edit/export, and hosted production still deploys Streamclone GHCR images via private `streampulse-ops`.
- **CHAT/PULSE sidebar chrome is always on** when Twitch chat layout is present on channel pages. **`chatClosedPulseDockEnabled`** (default false) is the only opt-in for the bottom-right floating dock when chat is closed.

## Commands

```bash
npm run build      # dist/ for Load unpacked (run after EVERY source change)
npm run dev        # vite build --watch — rebuilds dist/ on save (Chrome still needs a manual reload)
npm run typecheck
npm test
```

### Agents: always rebuild after editing extension code

After **any** change under `src/`, `vite.config.ts`, or `manifest.json`:

1. Run **`npm test`** when you touched logic covered by tests.
2. Run **`npm run build`** — **required** before telling the user to reload; `dist/` is gitignored and Chrome loads the last build, not your working tree.
3. Remind the user: `chrome://extensions` → **Reload** extension, then **hard-refresh** the Twitch tab.

Skipping `npm run build` makes fixes look broken (stale `dist/content/twitch.js`).

### Always rebuild before loading (avoid stale-bundle regressions)

- `dist/` is a **build artifact** (gitignored). It reflects **whatever branch / working tree you last built from**, not your current checkout.
- After **any** extension source change — and especially after **switching branches or applying a stash** — run `npm run build` before loading. Skipping this loads a stale bundle from another branch and looks like the extension "reverted" to an old version.
- Chrome does **not** hot-reload an unpacked extension when `dist/` changes on disk. To actually see a new build:
  1. `chrome://extensions` → **Reload** the Streamclone Pulse extension
  2. Hard-refresh the Twitch tab
- `npm run dev` (`vite build --watch`) rebuilds `dist/` automatically on save but still requires the manual Chrome reload above.

Stack: `make up` in streamclone → `curl http://localhost:8090/v1/extension/health`.
