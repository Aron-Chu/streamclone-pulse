# StreamPulse web

Vite + React portal for StreamPulse. Shared `@streampulse/*` packages are
**Pulse-owned** in-repo workspaces at `../packages/*` (RPR-6). No sibling
`streampulse-backend` checkout is required for package resolution.

**Public `/analytics` is no-login** — it reads hosted production data by default. No beta key, no local backend stack, and no `/setup` flow required for browsing.

```bash
npm install
npm run build:packages   # ensures ../packages/*/dist via root ensure:packages
npm run dev:hosted       # http://localhost:5173 → https://api.streampulse.stream (default)
npm run dev:local        # explicit local StreamPulse backend at http://localhost:8081 (requires opt-in env)
npm run typecheck && npm test && npm run build
```

**Node:** portal CI uses **Node 22 LTS** (`engines.node`). Local Node 20+ is usually fine; prefer 22 to match CI.

## API targeting

| Command | Backend | Notes |
|---------|---------|-------|
| `npm run dev` / `dev:hosted` | `https://api.streampulse.stream` | Default — matches production portal |
| `npm run dev:local` | `http://localhost:8081` | Copy `.env.development.localhost.example` → `.env.development.localhost` (sets `VITE_ALLOW_LOCAL_BACKEND=1`). Uses **streampulse-backend** compose — not Streamclone `:8090`. |
| Production build / Pages deploy | `https://api.streampulse.stream` only | `check:backend-url` fails on localhost in bundle |

When a non-hosted backend is active (local dev or custom override), the hub shows a **warning banner** (`HubBackendSourceBanner`) for operators only — production hosted users never see API hostnames.

Copy `.env.development.localhost.example` to `.env.development.localhost` when you need `npm run dev:local` against the StreamPulse backend. Without `VITE_ALLOW_LOCAL_BACKEND=1`, a localhost `VITE_BACKEND_URL` is ignored and the portal stays on hosted production.

**Full checklist:** [`docs/website-portal/local-dev-runbook.md`](../docs/website-portal/local-dev-runbook.md) (hosted-first defaults, troubleshooting, poll discipline).

## Troubleshooting local dev

| Symptom | Fix |
|---------|-----|
| Blank page / empty `#root` | Kill stale process on port 5173, restart `npm run dev`, hard refresh |
| Port conflict (Vite on 5174) | Only one dev server; kill zombie on 5173 |
| `@streampulse/*` module errors | `npm install` in portal; run `npm run build:packages` from repo root (`../packages/*/dist`) |
| Hub data looks wrong | Default is hosted — check `sessionStorage.sp.backendUrlOverride` |
| Local BFF 404 | Start **streampulse-backend** compose (`:8081`), not Streamclone `:8090` |

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

**Cloudflare Git builds:** packages resolve from in-repo `file:../packages/*`.
A single-repo clone is enough for package resolution after `npm run build:packages`.
Still prefer `npm run pages:deploy:prod` until Git-triggered builds are owner-approved.
Do **not** add Vercel.

## npm audit

High-severity findings must be fixed or explicitly dispositioned — see
[`docs/evidence/npm-audit-rpr6-2026-07.md`](../docs/evidence/npm-audit-rpr6-2026-07.md).
