# Agent guide — Streamclone Pulse extension

Chrome MV3 extension. Backend, migrations, and `pulse-core` live in the sibling **streamclone** checkout (`../twitch-7tv-clone` on disk; **streamclone** folder in multi-root workspace).

## Read first (this repo)

| Task | Doc |
|------|-----|
| Requirements R1–R12 | [`docs/pulse-extension/requirements.md`](docs/pulse-extension/requirements.md) |
| Architecture, API, schema | [`docs/pulse-extension/design.md`](docs/pulse-extension/design.md) |
| Task ledger (P0–P6) | [`docs/pulse-extension/tasks.md`](docs/pulse-extension/tasks.md) |
| **Figma UI (PNG + node IDs)** | [`docs/pulse-extension/figma-handoff.md`](docs/pulse-extension/figma-handoff.md) + [`figma/`](docs/pulse-extension/figma/) |
| Repo wiring | [`docs/CONTEXT.md`](docs/CONTEXT.md) |
| Extension code | `src/` |

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
