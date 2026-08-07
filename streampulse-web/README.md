# StreamPulse web



Vite + React portal for StreamPulse. This branch currently uses an explicit sibling package override for `@streampulse/pulse-core`, `@streampulse/pulse-charts`, and `@streampulse/analytics-console`. The override is recorded in [`../config/local-package-overrides.json`](../config/local-package-overrides.json) because this branch predates the clean Pulse-owned `packages/*` workspace on `origin/master`.



**Public `/analytics` is no-login** — it reads hosted production data by default. No beta key, no local backend stack, and no `/setup` flow required for browsing.



```bash

npm install

npm run check:package-cohort  # verify package links, source commit, and dirty state
# Release/CI gate: npm run check:package-cohort:strict (rejects a dirty sibling source)

npm run dev          # http://127.0.0.1:5174 → https://api.streampulse.stream (default)

npm run dev:local    # explicit local StreamPulse backend at http://localhost:8081 (requires opt-in env)

npm run typecheck && npm test && npm run build

```



## API targeting



| Command | Backend | Notes |

|---------|---------|-------|

| `npm run dev` | `https://api.streampulse.stream` | Default — matches production portal |

| `npm run dev:local` | `http://localhost:8081` | Copy `.env.development.localhost.example` → `.env.development.localhost` (sets `VITE_ALLOW_LOCAL_BACKEND=1`). Uses **streampulse-backend** compose — not Streamclone `:8090`. Portal remains on `http://127.0.0.1:5174`. |

| Production build / Pages deploy | `https://api.streampulse.stream` only | `check:backend-url` fails on localhost in bundle |



When a non-hosted backend is active (local dev or custom override), the hub shows a **warning banner** (`HubBackendSourceBanner`) for operators only — production hosted users never see API hostnames.



Copy `.env.development.localhost.example` to `.env.development.localhost` when you need `npm run dev:local` against the StreamPulse backend. Without `VITE_ALLOW_LOCAL_BACKEND=1`, a localhost `VITE_BACKEND_URL` is ignored and the portal stays on hosted production.



**Full checklist:** [`docs/website-portal/local-dev-runbook.md`](../docs/website-portal/local-dev-runbook.md) (hosted-first defaults, troubleshooting, poll discipline).



## Troubleshooting local dev



| Symptom | Fix |

|---------|-----|

| Blank page / empty `#root` | Kill stale process on port 5174, restart `npm run dev`, hard refresh |

| Port conflict (Vite on 5174) | Stop the process holding 5174. Vite uses `strictPort` and fails instead of moving to another checkout. |

| `@streampulse/*` module errors | Run `npm run check:package-cohort`, then `npm install`; confirm the manifest target exists |

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

`127.0.0.1:5174`.



**Cloudflare Git builds are NOT supported on this historical branch as-is.** `package.json` pulls packages by relative path from the sibling **streampulse-backend** checkout:



```json

"@streampulse/analytics-console": "file:../../streampulse-backend/packages/analytics-console",

"@streampulse/pulse-core": "file:../../streampulse-backend/packages/pulse-core"

```



A Cloudflare Git build clones only this repo, so those `file:` deps will not
resolve. The clean migration target is the in-repo workspace on
`streamclone-pulse origin/master`; do not copy it into this dirty branch or
silently switch sibling package sources. Until branch WIP is reconciled, use
the local `npm run pages:deploy:prod` path above and run
`npm run check:package-cohort` before every build. Do **not** add Vercel.
