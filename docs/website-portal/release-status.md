# StreamPulse release status

Last updated: 2026-08-03 (v0.1.3 release-proof source readiness)

## Published Chrome Web Store (live)

| Field | Value |
|-------|-------|
| Listing | https://chromewebstore.google.com/detail/streampulse/nifgoonpcgmdhiffcpmhndjgkgahnelg |
| Extension ID | `nifgoonpcgmdhiffcpmhndjgkgahnelg` |
| Hosted API | https://api.streampulse.stream |

Website install CTAs use `streampulse-web/src/lib/publicSiteConfig.ts` only.
**Manual account gate (open):** confirm the live CWS listing version and change
Support URL to `https://streampulse.stream/support` before any 0.1.3 upload
(owner-gated; this repository does not assert the current dashboard version).

## v0.1.3 source target (not published)

| Field | Value |
|-------|-------|
| Extension/portal package version | `0.1.3` across manifests/packages/locks |
| Store upload / tag / release artifacts | **Not claimed** — requires separate owner authorization |
| Hosted migration `100000` + dark deploy | **Not claimed** — Stop Gate A only |

This document does **not** claim repository merge completion of all hardening PRs,
portal GA, Cloudflare Access apply, soak completion, capacity raise, or marketing blast readiness.

## Current posture (do not over-claim)

| Track | Decision | Notes |
|-------|----------|-------|
| Public site + analytics | **LIVE** | Command Center, CWS CTA, Privacy, Support, robots, and sitemap verified |
| Portal GA | **HOLD** | CSP/HSTS/CWV + Access + soak remain |
| Extension / Chrome Web Store | **PUBLISHED** (owner recheck live version) | The pending candidate source manifests are `0.1.3`; no 0.1.3 upload is claimed. Owner must verify the live listing is behind 0.1.3 before upload, along with the Support URL / dashboard state. Do not claim dashboard edits from this doc. |
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
- Release-proof workflow now requires an exact tag dispatch context; no final 0.1.3 ZIP
  attestation or store upload is claimed by this source status.

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
