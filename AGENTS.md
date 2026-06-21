# Agent guide — Streamclone Pulse extension

Chrome MV3 extension only. Backend, migrations, and canonical product spec stay in **Streamclone** (`../twitch-7tv-clone` or sibling checkout).

## Read first

| Task | Doc |
|------|-----|
| Extension overlay / worker / options | This repo `src/` |
| API contract, lanes, recap | [`../twitch-7tv-clone/docs/pulse-extension/design.md`](../twitch-7tv-clone/docs/pulse-extension/design.md) |
| Requirements R1–R12 | [`../twitch-7tv-clone/docs/pulse-extension/requirements.md`](../twitch-7tv-clone/docs/pulse-extension/requirements.md) |
| Task ledger | [`../twitch-7tv-clone/docs/pulse-extension/tasks.md`](../twitch-7tv-clone/docs/pulse-extension/tasks.md) |
| Shared scoring | `@streamclone/pulse-core` in `../twitch-7tv-clone/packages/pulse-core` |

## Rules

- **Content scripts:** `chrome.runtime.sendMessage` only — no `fetch`.
- **Service worker:** all HTTP to Streamclone (`/v1/extension/*`, `/v1/analytics/.../watch`).
- Default backend: `http://localhost:8090` (Caddy in Streamclone).
- New Go APIs → implement in Streamclone `internal/analytics`, not here.

## Commands

```bash
npm run build      # dist/ for Load unpacked
npm run typecheck
npm test
```

Stack must be up for live checks: `make up` in Streamclone → `curl http://localhost:8090/v1/extension/health`.
