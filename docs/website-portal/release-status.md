# StreamPulse release status

Last updated: 2026-07-19 (CWS listing pack on `codex/cws-listing-2026-07-19`; production API `v0.1.34-matched-rc`)

## Candidate identity

| Field | Value |
|-------|-------|
| Pulse tip | `origin/master` (Peak icons + portal status honesty merged) |
| Working branch | `codex/cws-listing-2026-07-19` |
| Live API | `v0.1.34-matched-rc` (matched API+workers; HOLD_AT_300) |

This document does **not** claim GA, CWS **approval**, Cloudflare Access apply, soak completion, capacity raise, or marketing blast readiness.

## Current posture (do not over-claim)

| Track | Decision | Notes |
|-------|----------|-------|
| Portal soft public beta | Soft GO (conditional) | Peak + privacy + status honesty live |
| Portal GA | **HOLD** | CSP/HSTS/CWV + Access + soak remain |
| Extension / Chrome Web Store | **READY TO SUBMIT** | Package + listing copy + 1280×800 screenshots prepared; Google Dashboard submit is human-only |
| Marketing / creator blast | **NO-GO** | HOLD_AT_300 + Access + soak first |
| Collector capacity | **HOLD_AT_300 / NO_GO_350** | Unchanged |

## What this candidate closes (application-owned)

Verified in this worktree against the commands recorded below:

- Landing / hub honesty: no client-invented Pulse / moment scores from `magnitude`, chat+emote formulas, or demo intensity labeled as scoring truth
- Portal route gate: `/setup` and `/login` deterministically redirect to `/analytics` (tests hardened for Navigate settlement)
- Vitest upgraded to **3.2.7** (root + `streampulse-web`) for GHSA-5xrq-8626-4rwp
- Public clip `analyticsHref` / `vodHref` sanitization (omit invalid; never rewrite)
- Extension runtime message parsing + emote-image HTTPS/host/MIME/size/timeout hardening
- Privacy contact source updated to `privacy@streampulse.stream` (public `/privacy` verification pending post-merge Pages deploy)
- Canonical Peak branding on landing, analytics, shared public navigation, and favicon; desktop + 390px browser captures verified

## Explicitly still open

- Operator: Chrome Web Store Developer Dashboard upload + submit ([listing pack](../pulse-extension/chrome-web-store-listing.md))
- Real Chrome optional-permission gesture for localhost BFF (manual / post-install)
- Cloudflare Access apply for `/v1/admin/pulse*`, backup schedule/offsite, Phase 11 soak pack (private streampulse-ops)
- Capacity raise — **HOLD_AT_300** unchanged
- Post-CWS-approval: Landing CTA → store URL

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
npm run validate:package
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
