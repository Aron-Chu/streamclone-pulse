# Streamclone Pulse (Chrome extension)

MV3 overlay for Twitch that reads Pulse analytics from **StreamPulse hosted** (`https://api.streampulse.stream`) by default.

## Prerequisites

1. Node 20+.
2. **Optional:** local Streamclone stack on `http://localhost:8090` (`make up` in the main repo) — only if you explicitly opt into local backend in Options.

Public analytics at [streampulse.stream/analytics](https://streampulse.stream/analytics) uses the hosted API with **no beta key** and **no local stack**.

## Install & build

```bash
npm install
npm run build
```

`@streamclone/pulse-core` is linked from `../twitch-7tv-clone/packages/pulse-core` via `file:` in `package.json`. Adjust the path if your checkout folder name differs.

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
| **Local stack** | `http://localhost:8090` | Requires explicit save in Options (`localBackendOptIn`); stale localhost URLs auto-reset to hosted |
| **Custom API** | any other HTTPS host | Advanced / staging only |

Poll interval defaults to 30s. Beta keys are optional operator tools — **not required** for public `/analytics`.

## Tests

```bash
npm run typecheck
npm test
go test ./internal/analytics/...   # run in streamclone repo for BFF
```

## GitHub repo (manual)

If automated `gh repo create` fails:

```bash
cd streamclone-pulse
git init
git add .
git commit -m "chore: initial MV3 scaffold"
gh repo create Aron-Chu/streamclone-pulse --private --source . --push
```

## Spec (canonical)

Product requirements and API contracts live in **this repo**:

- [`docs/pulse-extension/README.md`](docs/pulse-extension/README.md) — sidebar chrome bar layout, **7TV coexistence**
- [`docs/pulse-extension/requirements.md`](docs/pulse-extension/requirements.md)
- [`docs/pulse-extension/design.md`](docs/pulse-extension/design.md)
- [`docs/pulse-extension/tasks.md`](docs/pulse-extension/tasks.md)
- [`docs/pulse-extension/figma-handoff.md`](docs/pulse-extension/figma-handoff.md) — UI reference PNGs for Codex/agents without Figma MCP

Use the multi-root workspace `streamclone-pulse-extension.code-workspace` in Streamclone for one Cursor session over both trees.
