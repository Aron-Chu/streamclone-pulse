# Extension 0.1.2 release candidate — owner gates (2026-07-26)

**Status:** Release candidate prepared. **Stop before CWS/Edge upload.**

## Owner actions recorded in this program

| Gate | Status |
|------|--------|
| Live CWS Support URL → `https://streampulse.stream/support` | **Owner action required** (publisher console). Not changed by agents. |
| Retained mocked screenshot set `store/cws/screenshots/` | **Owner-approved for RC retention** under this program continuation (mocked harness; not live-capture docs/). |
| Activation flags (Sentry diagnostics / Turnstile / Linear / email / PostHog product analytics) | Remain **false / inactive** |
| npm publish | Not authorized |
| CWS / Edge upload | **Not authorized — stop** |

## Version bump

All authoritative extension/package versions bumped to **0.1.2** (exceeds reported live `0.1.1`).

## Freeze + proof

After merge: exactly one force-full on the protected release SHA; retain CWS/Edge ZIPs + checksums + validation reports + LICENSE/NOTICE + provenance on the draft GitHub release. Tag `v0.1.2`.
