# RPR-1 / RPR-2 closure evidence — 2026-07-25

**Status:** Accepted after gap repairs (B7 dual-watch proof + honest C2 ZIP fixtures) and post-merge force-full.

## Accepted master

| Field | Value |
|-------|-------|
| Master SHA | `da19e6e97b64efe5f75055f32a9a3c02363e5702` |
| Merge PR | [#53](https://github.com/Aron-Chu/streamclone-pulse/pull/53) (squash) |
| Merge-push CI | [`30147265212`](https://github.com/Aron-Chu/streamclone-pulse/actions/runs/30147265212) |
| Force-full CI | [`30147485091`](https://github.com/Aron-Chu/streamclone-pulse-private-archive/actions/runs/30147485091) (`force_full=true`, `head_sha=da19e6e`) |

## Force-full verification (`30147485091`)

| Check | Result |
|-------|--------|
| guard | success (`force_full=true`, `run_e2e=true`) |
| extension | success |
| portal | success |
| E2E | executed (`e2e_executed=true`; 31 passed) |
| final gate | `final-gate OK` |
| Package pin | `f663d002ff22351629dcaa9ed770a9c4a869ef92` |
| Bundle budget | after build; `dist/content/twitch.js` raw `471437` / gzip `134516` (baseline raw `469024` / gzip `135072`; max raw `515927` / max gzip `148580`) |
| Store validation | `package:cws` + `package:edge` ran |
| Artifacts uploaded | only `ci-classification` (404 bytes, retention 3d). **No** successful ZIP/dist/Gitleaks upload. Playwright failure upload skipped. |

## Test totals (force-full)

| Suite | Result |
|-------|--------|
| Extension unit | 97 files / 662 tests passed |
| Portal unit | 106 files / 592 tests passed |
| Mocked E2E | 31 passed |

## Generated packages (**not uploaded**)

| Target | Filename | SHA-256 | Bytes |
|--------|----------|---------|-------|
| development | `streampulse-extension-development-0.1.0.zip` | `e5b961d7d1d32133b1f1e19fd9023f2804945efd2807d75d67eb6bd4de5703ab` | 207550 |
| CWS | `streampulse-extension-cws-0.1.0.zip` | `cb5c5e48985e85f6ea0041e6eeb0b90eb099856c022785fc4c8c4bfa02ea2e7c` | 206470 |
| Edge | `streampulse-extension-edge-0.1.0.zip` | `7d18df5b9ed578929de19d3470174c72b48711a67abbc6f63259b3590008fb77` | 206470 |

Source manifests remain `0.1.0` and are **not uploadable** as an update if the live CWS listing is ahead (`0.1.1` reportedly). Owner must re-verify the dashboard version before any RPR-9 upload.

## Historical evidence retained (not full acceptance alone)

| Run | SHA | Role |
|-----|-----|------|
| `30144042786` | `e13a74e` | Prior force-full — evidence only until B7/C2 gap repair |
| `30138875909` | `cf2ef08` | Earlier historical force-full |

## Still open

- RPR-3 through RPR-9 pending at this closure
- **Superseded:** RPR-6 later completed (in-repo `packages/*`; see `RPR-3-6-acceptance-closure-20260725.md`) — sibling private `file:` package deps are no longer the clean-build blocker
- Do **not** start RPR-3 in this closure
