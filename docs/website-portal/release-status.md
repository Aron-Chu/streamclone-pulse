# StreamPulse release status

Last updated: 2026-07-22 (analytics Command Center + CWS website integration)

## Published Chrome Web Store (live)

| Field | Value |
|-------|-------|
| Listing | https://chromewebstore.google.com/detail/streampulse/nifgoonpcgmdhiffcpmhndjgkgahnelg |
| Extension ID | `nifgoonpcgmdhiffcpmhndjgkgahnelg` |
| Hosted API | https://api.streampulse.stream |

Website install CTAs use `streampulse-web/src/lib/publicSiteConfig.ts` only.
**Manual account gate (open):** change the live CWS Support URL from the Twitch channel
to `https://streampulse.stream/support` in the publisher console.

## Release identity

| Field | Value |
|-------|-------|
| Repository base | `origin/master` at `d4e19be148058adb59c2e0ddc38b2c2e4ab0b0a8` |
| Review branch | `release/analytics-cws-baseline-20260722` |
| Live portal | `command-center-cws-2026-07-22` deployed; repository landing in review |
| Live API | `v0.1.35-security-closure` (`HOLD_AT_300`) |

This document does **not** claim repository merge, portal GA, Cloudflare Access apply,
soak completion, capacity raise, or marketing blast readiness.

## Current posture (do not over-claim)

| Track | Decision | Notes |
|-------|----------|-------|
| Public site + analytics | **LIVE** | Command Center, CWS CTA, Privacy, Support, robots, and sitemap verified |
| Portal GA | **HOLD** | CSP/HSTS/CWV + Access + soak remain |
| Extension / Chrome Web Store | **PUBLISHED** (owner recheck live version) | Source manifests are `0.1.0` and are **not uploadable as an update** if the live listing is already ahead (reportedly may be `0.1.1` — owner verify). Support URL / dashboard state also require owner verification. Do not claim dashboard edits from this doc. |
| Marketing / creator blast | **NO-GO** | HOLD_AT_300 + Access + soak first |
| Collector capacity | **HOLD_AT_300 / NO_GO_350** | Unchanged |

## What this candidate closes (application-owned)

Verified in this worktree against the commands recorded below:

- Landing / hub honesty: no client-invented Pulse / moment scores from `magnitude`, chat+emote formulas, or demo intensity labeled as scoring truth
- Portal route gate: `/setup` and `/login` deterministically redirect to `/analytics` (tests hardened for Navigate settlement)
- Vitest upgraded to **3.2.7** (root + `streampulse-web`) for GHSA-5xrq-8626-4rwp
- Public clip `analyticsHref` / `vodHref` sanitization (omit invalid; never rewrite)
- Extension runtime message parsing + emote-image HTTPS/host/MIME/size/timeout hardening
- Privacy contact source updated to `privacy@streampulse.stream`; public Privacy and Support routes verified
- Canonical Peak branding on landing, analytics, shared public navigation, and favicon; desktop + 390px browser captures verified

## Explicitly still open

- Operator: change the live CWS Support URL to `https://streampulse.stream/support`
- Repository: review and merge `release/analytics-cws-baseline-20260722`
- Manual: run a real unpacked/published extension smoke on Twitch; automated mocked coverage is green
- Real Chrome optional-permission gesture for localhost BFF (manual / post-install)
- Cloudflare Access apply for `/v1/admin/pulse*`, backup schedule/offsite, Phase 11 soak pack (private streampulse-ops)
- Capacity raise — **HOLD_AT_300** unchanged

## Verification commands (this candidate)

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

```bash
curl -fsS https://api.streampulse.stream/v1/extension/health
curl -fsS https://api.streampulse.stream/v1/public/status
```

Promotion manifests, soak evidence, and SSH probes live in private **streampulse-ops**.

## Checklist pointers

- CWS: [`../pulse-extension/chrome-web-store-review-checklist.md`](../pulse-extension/chrome-web-store-review-checklist.md)
- Legacy IDs: [`../pulse-extension/legacy-identifiers.md`](../pulse-extension/legacy-identifiers.md)
