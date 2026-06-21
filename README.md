# Streamclone Pulse (Chrome extension)

MV3 overlay for Twitch that reads Pulse analytics from a running [Streamclone](https://github.com/Aron-Chu/streamclone) stack.

## Prerequisites

1. Streamclone stack on `http://localhost:8090` (`make up` in the main repo).
2. Node 20+.

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

Extension **Options** (or toolbar popup): default backend URL `http://localhost:8090`, poll interval 30s.

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

Product requirements and API contracts live in the main repo:

- [`../twitch-7tv-clone/docs/pulse-extension/requirements.md`](../twitch-7tv-clone/docs/pulse-extension/requirements.md)
- [`../twitch-7tv-clone/docs/pulse-extension/design.md`](../twitch-7tv-clone/docs/pulse-extension/design.md)
- [`../twitch-7tv-clone/docs/pulse-extension/tasks.md`](../twitch-7tv-clone/docs/pulse-extension/tasks.md)

Use the multi-root workspace `streamclone-pulse-extension.code-workspace` in Streamclone for one Cursor session over both trees.
