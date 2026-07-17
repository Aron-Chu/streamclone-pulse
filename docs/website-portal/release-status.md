# StreamPulse release status

Last updated: 2026-07-16 (public-release gap closure candidate — application/CI only)

## Current posture (do not over-claim)

| Track | Decision | Notes |
|-------|----------|-------|
| Portal soft public beta | Soft GO (conditional) | Keep beta framing; `/privacy` lands in this candidate |
| Extension / Chrome Web Store | **NO-GO** | Packaging + identity gaps closing in code; dedicated privacy email, screenshots, Sol/ops, unpacked Chrome smoke still open |
| Marketing / creator blast | **NO-GO** | Requires Sol capacity/abuse sign-off |
| Collector capacity | **HOLD_AT_300 / NO_GO_350** | Controlling ops decision — not changed by this repo |

Live health at audit time was still a canary tag (`v0.1.33-helix-top300-canary`). This document does **not** claim GA, 350 readiness, CWS submission, or a non-canary production promote.

## What this candidate closes (code)

- User-facing extension name **StreamPulse**
- Real `/privacy` route + footer/nav link + route tests (Twitch session wording; GitHub Issues interim contact)
- Filtered `streampulse-extension.zip` from the packable dist file set (Info-ZIP / tar / Windows .NET ZipArchive) + fail-closed entry validation + checksum check
- `tabs` removed; localhost moved to optional host permissions
- Portal CI: tests + `check:analytics-overlap` + `build:ci` (same shape as `origin/master`). Full portal `npm run typecheck` remains a **local** gate — CI `streampulse-backend@master` `analytics-console` currently imports SessionSignalTape / stream-route helpers that are not present on that ref, so remote typecheck fails outside this repo
- Public `/admin` is a 404, not an operator console placeholder

## Origin/master baseline repairs retained

These are **not** new product features for this release-gap track; they are kept because `origin/master` already imports or requires them:

| Change | Why retained |
|--------|----------------|
| `extendSeriesToTrailingEdge` / `overviewBarWidth` in `chartRollupUtils.ts` | Required for typecheck/build — `PulseOverviewChart` already imports them on `origin/master` but exports were missing |
| `getPulseDockPreference` / `setPulseDockPreference` in `storage.ts` | Required for typecheck/build — `PulseSettingsPanel` already imports them on `origin/master` but exports were missing |
| Beta key sync→local migration + optional localhost host permission helpers | Required for CWS privacy/permission packaging |
| Test mocks adding `chrome.runtime.id` / `permissions` / `storage.local` | Required so settings/prefetch tests match the optional-permission + local beta-key paths |
| Dirty-tracking fixture `chartWindow: '15m'` | Stale-test fix — default is already `'full'`, so `'full'` was not a dirty change |
| Adapter live-stats test uses offline/historical input | Avoids coupling to uncommitted local `pulse-core` trailing-minute WIP vs CI `streampulse-backend@master` |
| `extensionGamesToChartGames` keeps named full-stream game | Stale-test alignment with linked `@streampulse/pulse-charts` `hasMeaningfulGameSegments` (named single segment is meaningful) |
| Portal momentListDisplay / branding test string updates | Align fixtures/labels with StreamPulse naming and heatmap field shape already expected by code |

**Not introduced as new product work in this track:** chart trailing-edge / bar-width helpers and PulseDock preference APIs are compile repairs for imports already present on `origin/master`.

## Packaging notes

- Lexical entry order is enforced.
- Byte-identical ZIP bytes across OS/tools are **not** claimed (timestamps/extra fields may differ).
- Artifacts: `streampulse-extension.zip`, `streampulse-extension.zip.sha256` (checksum file is gitignored).

## Explicitly still open

- Dedicated privacy email (interim public contact on `/privacy` is https://github.com/Aron-Chu/streamclone-pulse/issues per product origin; note the product repo is private so anonymous visitors may see 404 — dedicated email remains a CWS blocker)
- Unpacked Chrome smoke: automatable gates passed on this candidate (SW, StreamPulse name, no `tabs`, Options/popup, hosted API requests on Twitch, beta-key local storage, settings persistence). **Manual remaining:** localhost optional-permission prompt requires a real Options user gesture.
- Cloudflare Access evidence for `/v1/admin/*` (Sol/ops)
- Store screenshots + listing copy + human submission (draft under local `.artifacts/cws-listing/`, not committed)
- Capacity / canary vs non-canary backend tag (Sol/ops)
- Backend package consistency restored via streampulse-backend#22 (`3e81669`); CI checks out `streampulse-backend@master` (no temporary branch pin)
- Dirty WIP in other checkouts must not be shipped
- Extension icon PNGs on this branch are still tiny stubs (human artwork replacement before CWS)

## Packaging commands

```bash
npm run typecheck
npm test
npm run build
node --check scripts/zip-dist.mjs
node --check scripts/validate-extension-package.mjs
npm run zip
npm run validate:package
```

## Hosted production checks (public)

```bash
curl -fsS https://api.streampulse.stream/v1/extension/health
curl -fsS https://api.streampulse.stream/v1/public/status
```

Promotion manifests, soak evidence, and SSH probes live in private **streampulse-ops**.

## Checklist pointers

- CWS: [`../pulse-extension/chrome-web-store-review-checklist.md`](../pulse-extension/chrome-web-store-review-checklist.md)
- Legacy IDs: [`../pulse-extension/legacy-identifiers.md`](../pulse-extension/legacy-identifiers.md)
