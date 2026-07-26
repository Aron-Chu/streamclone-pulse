# RPR-7/8/9 public-source cutover evidence — 2026-07-26

**Status:** Public-source cutover **complete**. Store release **pending**.  
Vendor / client activation flags remain **false** (diagnostics, Turnstile,
Linear, email, PostHog product analytics — not activated by this program).

## Clean public repository

| Field | Value |
|-------|--------|
| Remote | `https://github.com/Aron-Chu/streamclone-pulse` |
| Visibility | **public** |
| Default branch | `master` |
| Clean content commit | `beb5e5d11ae908857df63c0fb169b914173364d0` |
| Tip after Actions registration | `b0b0274b490bfb704d559b2c5642bc9cfde149b4` |
| Tree SHA (unchanged by empty CI-register commit) | `405074037813a8eca77185234740914a3af63cb2` |
| Force-full (exactly one cutover proof) | [`30181022926`](https://github.com/Aron-Chu/streamclone-pulse/actions/runs/30181022926) |
| Classification | `forced-full` (`run_extension/portal/e2e=true`, `e2e_executed=true`) |
| Jobs | guard + extension + portal + final `CI` — all success |
| Anonymous clone | verified at tip `b0b0274…` / tree `40507403…` |
| Fork PR proof | [#1](https://github.com/Aron-Chu/streamclone-pulse/pull/1) from `arontestr` → run [`30181238523`](https://github.com/Aron-Chu/streamclone-pulse/actions/runs/30181238523) (required `CI` green; closed after evidence) |

## Historical private archive

| Field | Value |
|-------|--------|
| Rename target | `Aron-Chu/streamclone-pulse-private-archive` (**private**) |
| Actions | **disabled** |
| Pre-cutover force-fulls | remain on the archive (example: [`30178915753`](https://github.com/Aron-Chu/streamclone-pulse-private-archive/actions/runs/30178915753), [`30147485091`](https://github.com/Aron-Chu/streamclone-pulse-private-archive/actions/runs/30147485091)) |
| Note | Links under `Aron-Chu/streamclone-pulse/actions/runs/…` for those historical IDs are **dead** on the clean public repo — use archive URLs |

## Still private

| Repo | Visibility |
|------|------------|
| `streampulse-backend` | private |
| `streampulse-ops` | private |
| `streamclone-pulse-private-archive` | private |

## RPR ledger after cutover

| Gate | Status |
|------|--------|
| RPR-3 / RPR-4 / RPR-5 | **Implementation complete; activation pending** |
| RPR-6 | **Complete** |
| RPR-7 | **Clean export complete** (governance + public-source scrub for publication) |
| RPR-8 | **Active** (`default-branch` ruleset `19748279`); recovery doc: [`../pulse-extension/ruleset-recovery.md`](../pulse-extension/ruleset-recovery.md) |
| RPR-9 | **Public-source cutover complete; store release pending** |

## Explicit non-goals of the cutover

- CWS / Edge upload
- npm publish
- Enabling Sentry diagnostics, Turnstile, Linear, email, or PostHog product analytics
- Changing backend / ops / archive visibility
- History rewrite of the private archive
