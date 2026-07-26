# StreamPulse CWS mocked screenshot provenance — v0.1.2 assurance

**Kind:** mocked Twitch HTML fixtures + extension Playwright harness (not creator/live media).  
**Dims:** 1280×800 PNG for all submission images.  
**Harness:** `tests/e2e/specs/cws-extension-screenshots.mocked.spec.ts`  
**Capture command:** `npm run capture:cws:mocked`  
**Owner rights:** Owner-approved for RC retention (2026-07-26 program continuation); live-capture under `docs/` remains excluded from submission.

## Source SHAs

| Role | SHA | Notes |
|------|-----|-------|
| Screenshot tree last committed | `2031f9c9f726c13b6351273d0975bb130b16910a` (`v0.1.2` RC freeze) | Images + `store/cws/screenshots/manifest.json` |
| Assurance / store tag tip | `96f0f3d19e88df15c9abc72edb69d69409e6f919` (`v0.1.2-store`) | CodeQL closure + attested packaging; no intentional overlay chrome redesign |

Visual parity claim for store upload: screenshots were produced from the mocked harness against packaged `dist/`. Assurance SHA changes were security/CI (emote URL allowlist, temp paths, CodeQL, attested workflow). Emote CDNs used by fixtures remain on the allowlist. **If owner requires pixel proof against the attested ZIP, re-run `npm run capture:cws:mocked` on a clean checkout of `v0.1.2-store` before upload.**

## Image digests (committed tree @ `2031f9c…`)

| File | SHA-256 | Dimensions |
|------|---------|------------|
| `01-live-pulse.png` | `e527c95b52ecede1301efc172db8edebaf34599bf760f0beccf3217f38d4bd33` | 1280×800 |
| `02-coverage.png` | `b3eb0acc993505fa17af07ffecd7a5b0f7c60d906fddcfaf8a02644e66dbdd03` | 1280×800 |
| `03-vod-replay.png` | `4ad3018003bcbb0582be3341002a34721c91afc04d9ae0cccd52577a76257552` | 1280×800 |
| `04-most-reacted.png` | `e488818dcd0ac0e3bf00266443fd6826f65cf35997da5723294cc9d28e885854` | 1280×800 |
| `manifest.json` | `2e4f99acf3f58e7880dd6996b4a32eb4ffd78d42e682e0a352bcf55b9be8fc21` | n/a |

## Submission set hygiene

- Path used: `store/cws/screenshots/` only.
- No creator/live Twitch capture media in the submission set.
- `docs/pulse-extension/cws-screenshots/` (if present historically) is **not** part of the clean public submission set.
