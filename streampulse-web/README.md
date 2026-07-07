# StreamPulse web

Vite + React portal for StreamPulse. Requires sibling **streamclone** checkout at `../../twitch-7tv-clone` for `@streamclone/pulse-core` and `@streamclone/analytics-console`.

**Public `/analytics` is no-login** — it reads hosted production data by default. No beta key, no local Streamclone stack, and no `/setup` flow required for browsing.

```bash
npm install
npm run dev:hosted   # http://localhost:5173 → https://api.streampulse.stream (default)
npm run dev:local    # explicit local stack at http://localhost:8090 (requires opt-in env)
npm run typecheck && npm test && npm run build
```

## API targeting

| Command | Backend | Notes |
|---------|---------|-------|
| `npm run dev` / `dev:hosted` | `https://api.streampulse.stream` | Default — matches production portal |
| `npm run dev:local` | `http://localhost:8090` | Copy `.env.development.localhost.example` → `.env.development.localhost` (sets `VITE_ALLOW_LOCAL_BACKEND=1`) |
| Production build / Pages deploy | `https://api.streampulse.stream` only | `check:backend-url` fails on localhost in bundle |

When not per-session override or local dev backend is active, the hub and channel console show a **warning banner** (`HubBackendSourceBanner`) naming the API source.

Copy `.env.development.localhost.example` to `.env.development.localhost` when you need `npm run dev:local` against the Streamclone stack. Without `VITE_ALLOW_LOCAL_BACKEND=1`, a localhost `VITE_BACKEND_URL` is ignored and the portal stays on hosted production.

## Production deploy (Cloudflare Pages)

**Supported path — local deploy of a prebuilt bundle:**

```bash
npm run pages:deploy:prod   # requires CLOUDFLARE_API_TOKEN (and optionally CLOUDFLARE_ACCOUNT_ID)
```

`pages:deploy:prod` builds locally with `VITE_BACKEND_URL=https://api.streampulse.stream`
(it **rejects** any non-prod backend), runs `check:backend-url` (fails the deploy if
`localhost`/`127.0.0.1`/`laptopworker` appears in the bundle or HTML shells), then
uploads the prebuilt `dist/` with `wrangler pages deploy`. The public site is fully
static + the hosted API, so it works with your local PC off and never depends on
`localhost:5173`.

**Cloudflare Git builds are NOT supported as-is.** `package.json` pulls two
workspace packages by relative path from the sibling streamclone checkout:

```json
"@streamclone/analytics-console": "file:../../twitch-7tv-clone/packages/analytics-console",
"@streamclone/pulse-core": "file:../../twitch-7tv-clone/packages/pulse-core"
```

A Cloudflare Git build clones only this repo, so those `file:` deps will not
resolve. To use Git-triggered builds you would need to either (a) make both repos
available to the build (git submodule / monorepo / a vendored copy step), or
(b) publish `@streamclone/analytics-console` and `@streamclone/pulse-core` to a
registry and switch to versioned deps. Until then, use the local
`npm run pages:deploy:prod` path above. Do **not** add Vercel.
