# Extension 0.1.2 store assurance — owner gates (2026-07-26)

**Status:** Assurance complete through attested packaging. **Stop before CWS/Edge upload.**

## Tagged sources

| Ref | SHA | Role |
|-----|-----|------|
| `v0.1.2` | `2031f9c9f726c13b6351273d0975bb130b16910a` | Original RC freeze (immutable under tag ruleset) |
| `v0.1.2-store` | `96f0f3d19e88df15c9abc72edb69d69409e6f919` | CodeQL-clean assurance tip; owner-dispatched attested packages |
| Manifest / package version | **0.1.2** | Unchanged across both tags |

## Owner actions (still required for upload)

| Gate | Status |
|------|--------|
| Live CWS Support URL → `https://streampulse.stream/support` | **Owner action required** (publisher console) |
| Confirm current dashboard version | **Owner confirm** (the historical 0.1.1 note is not a current source-of-truth claim) |
| Compare proposed upload digest to attested CWS ZIP | **Owner confirm** after Release artifacts run |
| Explicit CWS upload authorization | **Not granted — stop** |
| Activation flags (Sentry / Turnstile / Linear / email / PostHog) | Remain **false / inactive** |
| npm publish | Not authorized |
| Edge publish | Hold until Chrome 0.1.2 canary passes |

## Assurance proof (Batch 1–3)

1. CodeQL highs closed on PR [#5](https://github.com/Aron-Chu/streamclone-pulse/pull/5); squash merge → `96f0f3d…`.
2. Open CodeQL alerts on master after reanalysis: **0** (mockup `js/identity-replacement` dismissed as false positive with written justification).
3. Tag ruleset `version-tags`: **update**, **deletion**, and **non_fast_forward** prohibited for `refs/tags/v*`.
4. Draft GitHub release marked **prerelease**; unsigned `RELEASE_PROVENANCE.txt` renamed to `RELEASE_BUILD_METADATA.txt`.
5. Owner-dispatched workflow: `.github/workflows/release-artifacts.yml` (tag + expected SHA verify → package CWS/Edge → validate → attest → 90-day artifacts).
6. Screenshot provenance: [`CWS-screenshot-provenance-v0.1.2.md`](./CWS-screenshot-provenance-v0.1.2.md).

The v0.1.2 evidence predates the exact-tag dispatch and `--source-ref` /
`--source-digest` verification now required by `Release artifacts`. Do not use
this historical record as proof for a future v0.1.3 ZIP.

## Attested package (do not upload until owner authorizes)

| Field | Value |
|-------|-------|
| Tag | `v0.1.2-store` |
| Source SHA | `96f0f3d19e88df15c9abc72edb69d69409e6f919` |
| Workflow run | [`30188051732`](https://github.com/Aron-Chu/streamclone-pulse/actions/runs/30188051732) |
| Force-full CI | [`30188045886`](https://github.com/Aron-Chu/streamclone-pulse/actions/runs/30188045886) |
| CWS ZIP SHA-256 | `97cd83de5460064b77818408c720d99643e5d701ac3fde2df96bbd3579685df6` |
| Edge ZIP SHA-256 | `97cd83de5460064b77818408c720d99643e5d701ac3fde2df96bbd3579685df6` |
| CWS attestation | https://github.com/Aron-Chu/streamclone-pulse/attestations/37131572 |
| Edge attestation | https://github.com/Aron-Chu/streamclone-pulse/attestations/37131577 |
| Manifest version | `0.1.2` |

Unattested draft ZIPs from the earlier `v0.1.2` draft (CWS `49bf0a9e…`) must **not** be uploaded.
