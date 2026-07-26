# Excluded media report — Phase 2 clean Pulse source

Source SHA: `add69d00c686b3aaf18b1ee06749f5c1510621c5`  
Policy: exclude live / uncertified Chrome Web Store media; keep approved mocked fixtures.

## Removed from clean tree

| Path | Reason |
|------|--------|
| `docs/pulse-extension/cws-screenshots/**` (entire tree) | Uncertified store-prep / live-capture corpus. Capture meta identity references `codex/cws-live-screenshots-2026-07-19`. Public-readiness audit (2026-07-25) explicitly did **not** certify rights clearance for this tree. |

Removed files included listing-sized PNGs (`01-…` through `05-…`, marquee/promo/icon variants) and `sources/*-playwright-*-raw.png` plus capture meta JSON.

## Retained (approved mocked / non-CWS fixtures)

| Path | Reason |
|------|--------|
| `store/cws/screenshots/{01-live-pulse,02-coverage,03-vod-replay,04-most-reacted}.png` | Authoritative RC upload set; `screenshots/manifest.json` harness = `tests/e2e/specs/cws-extension-screenshots.mocked.spec.ts` |
| `store/cws/screenshots/manifest.json` | Provenance for mocked RC set |
| `store/cws/icons/*`, `store/cws/source/*` | Brand / Peak mark assets (not live Twitch captures) |
| `tests/e2e/**` fixtures + mocked CWS screenshot harness | Approved mocked e2e fixtures / generators |
| `streampulse-web/tests/e2e/**-snapshots/*.png` | Portal visual regression goldens (not CWS listing media) |
| `docs/pulse-extension/figma/**`, `docs/design/evidence/**` | Design / UX evidence (not CWS listing candidates) |
| `public/icons/*` | Extension toolbar icons |

## Hygiene

- `.gitignore` now ignores `docs/pulse-extension/cws-screenshots/` so operator regenerations of the capture script do not re-enter the public tree.
- Capture scripts (`scripts/capture-cws-pulse-screenshot.mjs`, `scripts/gen-cws-screenshots.ps1`) remain as generators; outputs are local-only until an owner-certified set is explicitly promoted (prefer promoting into `store/cws/screenshots/` after review).

## Not present in source tree

- `listing-assets/`, `.artifacts/` (already gitignored; absent from `git archive`)
- No separate `store/cws/live/` or untracked live-Twitch screenshot directory in the archived SHA
