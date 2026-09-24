# StreamPulse release status

Last updated: 2026-09-24 UTC (v0.2.1 source target and Moments readiness recheck)

## Published Chrome Web Store (live)

| Field | Value |
|-------|-------|
| Listing | https://chromewebstore.google.com/detail/streampulse/nifgoonpcgmdhiffcpmhndjgkgahnelg |
| Extension ID | `nifgoonpcgmdhiffcpmhndjgkgahnelg` |
| Hosted API | https://api.streampulse.stream |

Website install CTAs use `streampulse-web/src/lib/publicSiteConfig.ts` only.
**Manual account gate (open):** confirm the publisher-dashboard version (the
public listing reported `0.1.1` on 2026-09-20) and change the dashboard Support
URL to `https://streampulse.stream/support/` before any 0.2.1 upload. The public
listing was observed linking Support to Twitch on that date. Public-page and
source checks are not publisher-dashboard evidence; this repository does not
claim the configured field has changed.

## v0.2.1 source target (not published)

The `0.1.3` reliability candidate was never uploaded; its records remain
historical provenance and are not rewritten.

| Field | Value |
|-------|-------|
| Extension source version | `0.2.1` across the extension manifest, root package metadata, release manifest, and root lock metadata |
| Portal package version | `0.1.3`; this internal package version is independent of the CWS extension candidate |
| Default chart range | **Full stream** (`defaultChartWindowMigratedToFullV3`); the old `60m` default is historical |
| Content bundle budget | **Open** — see the bundle-budget gate; must pass before upload |
| Store upload / tag / release artifacts | **Not claimed** — requires separate owner authorization |
| Hosted migration `100000` + dark deploy | **Not claimed** — Stop Gate A only |

This document does **not** claim repository merge completion of all hardening PRs,
portal GA, Cloudflare Access apply, soak completion, capacity raise, or marketing blast readiness.

## Current posture (do not over-claim)

| Track | Decision | Notes |
|-------|----------|-------|
| Public site + analytics | **SOURCE GREEN / LIVE RECHECK OPEN** | Source tests cover Command Center, CWS CTA, Privacy, Support, robots, and sitemap. A current hosted route smoke must be recorded separately. |
| `moments-readiness` | **BLOCKED** | Local mocked browser checks pass, but the real-data gate has no approved reconciliation manifest, hosted ranked volume is 404, and discovery activity is 503. Do not interpret an unavailable History or Explore panel as a quiet day. |
| Portal GA | **HOLD** | CSP/HSTS/CWV + Access + soak remain |
| Extension / Chrome Web Store | **LIVE LISTING / v0.2.1 HOLD** | An older listing is public; the pending source manifests are `0.2.1`, but no 0.2.1 candidate acceptance or upload is claimed. Owner must verify the publisher-dashboard version and Support URL. |
| Marketing / creator blast | **NO-GO** | HOLD_AT_300 + Access + soak first |
| Collector capacity | **HOLD_AT_300 / NO_GO_350** | Unchanged |

The first ranked Moments contract is observed IRC volume among detector-selected
moments on verified retained completed UTC days. Relative/Top remains hidden
until separately calibrated, and the existing Pulse Explorer route stays until
its replacement works. This product decision does not pass the real-data or
hosted activation gates.

The public read-only check at **2026-09-24 03:04–03:05 UTC** returned 404 for
`/supporter`, `/terms`, `/refunds`, and `/v1/billing/supporter`; ranked volume
returned 404 and discovery activity returned 503. These are point-in-time hosted
responses, not a diagnosis of the deployment state. The three public pages and
the billing route must be checked before an extension build that links to them
is published. Moments needs a passing real-data reconciliation and retained-day
certificate before ranked reads are enabled or treated as release-ready.
At **04:14 UTC**, a second public read-only GET returned the same 404 status
for the three pages and billing route, 503 for discovery activity, and 404
for ranked volume.
The local browser-readiness preflight now verifies the StreamPulse extension
health contract and an HTTP 200 `/readyz` response from `:8081` before
accepting a BFF. It still stops on the missing approved stored-IRC snapshot,
reconciliation manifest, and independently recorded SHA-256; the running
hosted-first `:5173` portal is not that real-data proof.

At **2026-09-24 03:08 UTC**, public hosted hub requests with
`include=livePulseMoments` and `include=topEmotes,topMovers` returned identical
decoded 786,974-byte bodies containing all three fields. The candidate's
smaller `include=` projections are not active in the hosted response yet;
browser parse time and compressed transfer size were not measured.
At **03:34 UTC**, both include requests still returned all three fields at
789,154 UTF-8 bytes each; discovery activity returned 503 and ranked volume
returned 404. These are point-in-time public reads, not a rollout diagnosis.
An opt-in local check against a fresh public 30-minute hub snapshot passed the
candidate backend's HTTP projection path at 20,930 bytes for Moments and 7,938
bytes for landing tickers; the portal normalizer accepted both outputs. This
does not replace hosted route and browser performance checks.
Another fresh public snapshot measured 779,083 UTF-8 bytes before projection,
20,875 bytes for Moments, and 7,967 bytes for landing tickers. In local
headless Chromium, the full body took a median 1.0 ms to parse and 1.1 ms to
normalize after warmup; both projected bodies were below 0.1 ms median for
each stage. This measures local parse and normalization CPU, not hosted
transfer, decoding, or rendering. The temporary snapshot was deleted.

Populated local History and Explore fixtures passed ad hoc `axe-core` WCAG
2.0/2.1/2.2 A/AA scans at 390px and 1440px in the tested states. History
included Filters open and closed; Explore included arrival and settled rows.
The result-row entrance was changed to keep text fully opaque, with a browser
first-frame assertion. These checks support the local accessibility gate for
those states; they are not a hosted accessibility sign-off.
A disposable PostgreSQL 16 probe also passed a short concurrent 300-stream
source-write, certificate, and indexer run; it does not establish sustained
hosted capacity or backlog drain. The indexer catch-up gate remains open.

The local portal candidate was copied to an isolated clean worktree with 551
byte-matched files and one deletion; fresh installs, portal typecheck,
`build:ci`, and 1,432 portal tests passed there. A broader package run exposed
one undersized chart control and two stale test expectations. After corrections,
`npm run test:packages` passed 154 analytics-console, 187 pulse-charts, and 64
pulse-core tests. The local `test:e2e:audit` command now includes the chart
interaction and responsive bucket-rail suites and passed **91/91** Chromium
checks on a fresh production preview, including zoom, selected-value stability
on hover, the selected-bucket inspector, and chart-canvas width on both sides
of the 1536px outer Live Wire rail breakpoint. These local checks
do not satisfy the missing approved real-data manifest or hosted release gates.

The separate no-mock Moments readiness harness now rejects today's still-open
UTC date, hosted or mutating browser data requests, and a collection that ends
at 100 rows despite a manifest naming more than 100. Its 13 preflight tests and
portal typecheck pass. The exact real-data command still stops at global
preflight because the approved stored-IRC manifest and independent digest do
not exist; the three-page browser assertion has not run on real data.
A separate synthetic 101-row Explore fixture passed all 9 ranked browser cases,
including the third page and its `#101` rank. This validates the portal path
without substituting for database reconciliation.

## What this source target closes (application-owned)

The source contract includes the following. Re-run the commands recorded below
on the chosen release SHA before treating any item as release evidence:

- Landing / hub honesty: no client-invented Pulse / moment scores from `magnitude`, chat+emote formulas, or demo intensity labeled as scoring truth
- Current route contract: `/analytics` is the Command Center with Live Wire;
  `/analytics/moments` is the canonical Moments workspace. The separate
  `/analytics/explore` route remains until its replacement works. `/setup` and
  `/login` redirect to `/analytics`.
- Vitest upgraded to **3.2.7** (root + `streampulse-web`) for GHSA-5xrq-8626-4rwp
- Public clip `analyticsHref` / `vodHref` sanitization (omit invalid; never rewrite)
- Extension runtime message parsing + emote-image HTTPS/host/MIME/size/timeout hardening
- Privacy contact source updated to `privacy@streampulse.stream`; public Privacy and Support routes verified
- Canonical Peak branding on landing, analytics, shared public navigation, and favicon; desktop + 390px browser captures verified
- Release-proof workflow now requires an exact tag dispatch context; no final 0.2.1 ZIP
  attestation or store upload is claimed by this source status.

## Explicitly still open

- Operator: change the live CWS Support URL to `https://streampulse.stream/support/`
- Repository/CI: choose a release SHA and record all required local gates plus an executed green remote CI run on that same SHA
- Manual: run a real unpacked extension smoke on Twitch for the release SHA; automated mocked coverage is not live evidence
- Real Chrome optional-permission gesture for localhost BFF (manual / post-install)
- Hosted: record current portal route smoke for `/analytics`,
  `/analytics/moments`, `/support/`, and `/privacy/`; source tests do not prove
  the deployed Pages version
- Hosted: publish `/supporter`, `/terms`, and `/refunds` before an extension
  release that links to them; verify `/v1/billing/supporter` is no longer 404
- Moments: pass the local real-data reconciliation gate and verify indexed
  retention, ranked volume responses, indexer catch-up capacity under hosted
  contention, and release flags against a chosen backend release before
  changing `moments-readiness` from **BLOCKED**
- Billing/email: record live Stripe checkout/portal/webhook reconciliation and
  Resend delivery evidence before enabling or advertising paid signup. Also
  document the live-mode Stripe Tax registration decision and a representative
  checkout tax result.
  Source and mocked tests alone do not establish either service is operational.
- Cloudflare Access apply for `/v1/admin/pulse*`, backup schedule/offsite, Phase 11 soak pack (private streampulse-ops)
- Capacity raise — **HOLD_AT_300** unchanged

## Verification commands (chosen release SHA)

Extension / root:

```bash
npm ci
npm run typecheck
npm test
npm run build
node --check scripts/zip-dist.mjs
node --check scripts/validate-extension-package.mjs
npm run package:cws
npm run validate:package:cws
npm audit --omit=dev
npm audit
```

Portal (`streampulse-web/`):

```bash
cd streampulse-web
npm ci
npm run typecheck
npm run check:analytics-overlap
npx vitest run --config vitest.config.ts tests/routes.test.tsx tests/auth.test.tsx
npm test
npm run build
npm audit --omit=dev
npm audit
```

## Hosted production checks (public only)

These commands are required live checks. Their presence here does not claim a
current pass; record timestamped output in the private promotion evidence.

```bash
curl -fsS https://api.streampulse.stream/v1/extension/health
curl -fsS https://api.streampulse.stream/v1/public/status
```

Promotion manifests, soak evidence, and SSH probes live in private **streampulse-ops**.

## Checklist pointers

- CWS: [`../pulse-extension/chrome-web-store-review-checklist.md`](../pulse-extension/chrome-web-store-review-checklist.md)
- Legacy IDs: [`../pulse-extension/legacy-identifiers.md`](../pulse-extension/legacy-identifiers.md)
