# Streamclone Pulse (Chrome extension)

MV3 overlay for Twitch that reads Pulse analytics from **StreamPulse hosted** (`https://api.streampulse.stream`) by default.

## Prerequisites

1. Node 20+ (portal CI uses Node 22 LTS; see `streampulse-web` `engines`).
2. **Optional:** local StreamPulse backend on `http://localhost:8081` (`make up` in **streampulse-backend**) — only if you explicitly opt into local backend in Options. Public Streamclone `:8090` is watch-only and does not serve extension BFF routes.

Public analytics at [streampulse.stream/analytics](https://streampulse.stream/analytics) uses the hosted API with **no beta key** and **no local stack**.

## Install & build

```bash
npm install
npm run build:packages   # builds in-repo @streampulse/* workspaces
npm run build
```

`@streampulse/pulse-core`, `@streampulse/pulse-charts`, and `@streampulse/analytics-console` live in this repo under `packages/*` (RPR-6; Pulse-owned). No sibling `streampulse-backend` checkout is required for package resolution.

## Load in Chrome

1. `npm run build`
2. Chrome → **Extensions** → **Developer mode** → **Load unpacked**
3. Select the `dist/` folder from this repo.

Open `https://www.twitch.tv/{channel}` — the overlay polls `GET /v1/extension/pulse/channels/{login}` via the service worker.

## Configuration

Extension **Options** (or toolbar popup) show the active **backend source** (Hosted corpus / Local stack / Custom API):

| Source | URL | When |
|--------|-----|------|
| **Hosted corpus** (default) | `https://api.streampulse.stream` | Normal use — matches public portal |
| **Local backend** | `http://localhost:8081` | Requires explicit save in Options (`localBackendOptIn`); stale localhost URLs auto-reset to hosted |
| **Custom API** | any other HTTPS host | Advanced / staging only |

Poll interval defaults to 30s. Beta keys are optional operator tools — **not required** for public `/analytics`.

Popup **“Backend OK (v0.3.0-rc18)”** (or similar) is the **hosted API deploy version** from `/v1/extension/health` — not the extension manifest version. Private ops pins which tag runs; release tags are still built from public streamclone. See streamclone [`docs/ops-migration-truth-table.md`](../twitch-7tv-clone/docs/ops-migration-truth-table.md).

## Tests

```bash
npm run ensure:packages
npm run test:packages
npm run typecheck
npm test
npm run pack:packages:check
npm run pack:packages:consumer
```

Go BFF tests run in **streampulse-backend** (`go test ./internal/analytics/...`), not this repo.

## Spec (canonical)

Product requirements and API contracts live in **this repo**:

- [`docs/pulse-extension/README.md`](docs/pulse-extension/README.md) — sidebar chrome bar layout, **7TV coexistence**
- [`docs/pulse-extension/requirements.md`](docs/pulse-extension/requirements.md)
- [`docs/pulse-extension/design.md`](docs/pulse-extension/design.md)
- [`docs/pulse-extension/tasks.md`](docs/pulse-extension/tasks.md)
- [`docs/pulse-extension/figma-handoff.md`](docs/pulse-extension/figma-handoff.md) — UI reference PNGs for Codex/agents without Figma MCP
- [`docs/pulse-extension/reliability-public-release-plan.md`](docs/pulse-extension/reliability-public-release-plan.md) — RPR ledger

Verified public mailbox: **`privacy@streampulse.stream` only**.
