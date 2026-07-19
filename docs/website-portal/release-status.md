# StreamPulse release status

Last updated: 2026-07-18 (application-owned release-closure candidate on `codex/release-closure-2026-07-18`)

## Candidate identity

| Field | Value |
|-------|-------|
| Starting SHA (audited upstream) | `c2a9d81b0e5c16f09308d3479a67be313139032b` (`origin/master`) |
| Working location | Clean worktree `C:/Users/Aron/streamclone-pulse-codex-release-closure` |
| Branch | `codex/release-closure-2026-07-18` |
| Live API (public check at audit time) | `v0.1.33-helix-top300-canary` — still a canary tag |

This document does **not** claim GA, CWS submission, Cloudflare Access/WAF sign-off, soak/rollback proof, capacity raise, or marketing blast readiness.

## Current posture (do not over-claim)

| Track | Decision | Notes |
|-------|----------|-------|
| Portal soft public beta | Soft GO (conditional) | Keep beta framing; honesty + URL hardening closed in this candidate |
| Portal GA | **NO-GO** | Soft beta only until ops/capacity/canary gates clear |
| Extension / Chrome Web Store | **NO-GO** | App hardening closed in code; icons, listing, optional-permission gesture, submission remain open |
| Marketing / creator blast | **NO-GO** | Requires Sol capacity/abuse sign-off |
| Collector capacity | **HOLD_AT_300 / NO_GO_350** | Controlling ops decision — not changed by this repo |

## What this candidate closes (application-owned)

Verified in this worktree against the commands recorded below:

- Landing / hub honesty: no client-invented Pulse / moment scores from `magnitude`, chat+emote formulas, or demo intensity labeled as scoring truth
- Portal route gate: `/setup` and `/login` deterministically redirect to `/analytics` (tests hardened for Navigate settlement)
- Vitest upgraded to **3.2.7** (root + `streampulse-web`) for GHSA-5xrq-8626-4rwp
- Public clip `analyticsHref` / `vodHref` sanitization (omit invalid; never rewrite)
- Extension runtime message parsing + emote-image HTTPS/host/MIME/size/timeout hardening
- Privacy contact aligned to deployed `privacy@streampulse.stream`
- Canonical Peak branding on landing, analytics, shared public navigation, and favicon; desktop + 390px browser captures verified

## Explicitly still open

- Extension icon PNGs remain tiny stubs — the approved portal Peak mark does not close the CWS PNG artwork/dimension gate
- Real Chrome optional-permission gesture for localhost BFF (manual)
- CWS listing copy, screenshots, submission, and store approval
- Cloudflare Access evidence for `/v1/admin/*`, WAF, soak, rollback (private streampulse-ops)
- Capacity / canary vs non-canary backend promote (Sol/ops) — **HOLD_AT_300** unchanged
- Dirty WIP in other checkouts must not be shipped

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
