# StreamPulse — Reliability, Public Release, and Repository Governance

**Status:** Phase 0–2 **complete**. **RPR-3/4/5** are **implementation complete; activation pending** (flags stay off). **RPR-6** is **complete**. **RPR-7** clean public export is **complete**. **RPR-8** ruleset is **active** (recovery: [`ruleset-recovery.md`](./ruleset-recovery.md)). **RPR-9** public-source cutover is **complete**; **store release pending**. Do **not** claim activation or store upload. Verified public mailbox: **`privacy@streampulse.stream` only**. Security reports: GitHub **Private Vulnerability Reporting** (enabled).  
**Canonical execution plan** for the reliability / public-release / governance program.  
Companion ledgers: [`tasks.md`](./tasks.md) (`RPR-*`), [`requirements.md`](./requirements.md) (R14–R18 for new gates; **R13 remains Emote metadata readiness**), [`design.md`](./design.md), [`release.md`](./release.md).

---

## Authoritative baseline

| Fact | Value |
|------|--------|
| Remote | `https://github.com/Aron-Chu/streamclone-pulse.git` (**public**) |
| Clean public tip (Actions-registered) | `b0b0274b490bfb704d559b2c5642bc9cfde149b4` |
| Clean content commit / tree | `beb5e5d11ae908857df63c0fb169b914173364d0` / `405074037813a8eca77185234740914a3af63cb2` |
| Cutover force-full (authoritative on clean repo) | [CI run `30181022926`](https://github.com/Aron-Chu/streamclone-pulse/actions/runs/30181022926) (`force_full=true`; `e2e_executed=true`; final-gate OK) |
| Cutover evidence | [`../evidence/RPR-7-9-public-cutover-20260726.md`](../evidence/RPR-7-9-public-cutover-20260726.md) |
| Historical private archive | `Aron-Chu/streamclone-pulse-private-archive` (**private**; Actions disabled) |
| Pre-cutover force-fulls (archive only) | [`30147485091`](https://github.com/Aron-Chu/streamclone-pulse-private-archive/actions/runs/30147485091) (`da19e6e`); [`30178915753`](https://github.com/Aron-Chu/streamclone-pulse-private-archive/actions/runs/30178915753) (`a21e18f1`) |
| Working rule | Implement only from a clean checkout/worktree of the clean public tip (or a descendant). Do not mutate the protected dirty local checkout. |
| Remote CI gate | Remote workflow runs must **execute jobs successfully** on the release SHA. Runs that start no jobs do not count as green. |

**Hard rule:** Public Actions minutes are a cost outcome of an authorized public-source cutover — not a reason to flip visibility. Remote green CI from the **exact** release SHA remains a mandatory store gate.

---

## Locked product decisions

1. **Chart range migration v2 (R14 landed):** Existing chart preferences (including `Full`) migrate once to `60m` under a v2 marker. A user who selects `Full` after v2 keeps it.
2. **Full history fetch (R14 landed):** Only after explicit user action (“Load full history”). Recurring polling always uses recent windows.
3. **Polling ownership (R14 landed):** Content scripts own tab-scoped polling. Service worker brokers, caches, and coalesces (`pulseGetCoordinator`). Do **not** add `chrome.alarms` unless no-tab durable polling becomes an explicit requirement.
4. **Twitch hosts:** Preserve the two Twitch hosts. Remote master already routes `sidebarPart="tabs"` to lightweight `OverlayTabsShell`; do not recreate obsolete dual-effect-controller fixes.
5. **Consent (R15 / RPR-3–5):** Extension diagnostics and product analytics have separate versioned, **default-off** consent. No durable install/session identifier. Portal Sentry (when `VITE_SENTRY_DSN` is set) is a separate, existing website path — not extension consent. Code may exist while hosted routes remain **activation pending** and must not be claimed as active.
6. **Support (R16 / RPR-4):** Extension Help will open a hosted StreamPulse form with Turnstile; no remote challenge script in the MV3 package. Implementation complete; **activation pending** / **not active**.
7. **Manifests (R18 landed for targets):** Store manifests contain **no** localhost permission. Development manifests may contain `localhost:8081`. Distinct CWS/Edge ZIP names + yauzl byte validation are acceptance-complete; do **not** upload until RPR-9.
8. **Packages (R17 / RPR-6):** `pulse-core`, `pulse-charts`, and `analytics-console` are **owned by Pulse** as public in-repo workspaces under `streamclone-pulse/packages` (Apache-2.0 + NOTICE; provenance `streampulse-backend@f663d002`). Backend package ownership is dropped. **Complete** (source ownership + distribution acceptance; cutover re-proved on force-full [`30181022926`](https://github.com/Aron-Chu/streamclone-pulse/actions/runs/30181022926); pre-cutover archive proof [`30178915753`](https://github.com/Aron-Chu/streamclone-pulse-private-archive/actions/runs/30178915753)).
9. **License:** Pulse uses **Apache-2.0**.
10. **Visibility:** Only `streamclone-pulse` is newly public. Keep `streampulse-backend`, `streampulse-ops`, `streamclone-pulse-private-archive`, `replayforge`, and `streampulse-sdlc` private.

---

## Scope (allowed repos)

| Repo | Allowed work |
|------|----------------|
| **streamclone-pulse** | Extension, portal, **owned** public client packages (`packages/*`), docs, CI, public-release candidate |
| **streampulse-backend** | Private APIs, correlation IDs, support outbox, telemetry proxies (no longer owns `@streampulse/*` packages) |
| **streamclone** | Public repo hardening + OAuth release-path remediation |
| **streamclone-scraper** | Minimal CI + immutable release integration |

Out of scope: unrelated personal repos; publicizing private Pulse/ops/RF/sdlc trees.

---

## Phases and owners

| Phase | Name | Primary owner surface | Rollback point |
|-------|------|----------------------|----------------|
| **0** | Authoritative baseline + documents | `streamclone-pulse` docs / public pages | Discard doc-only branch; leave unrelated checkouts untouched |
| **1** | Request contract + performance | Extension SW/content + tests | Revert migration/coalesce commits; prefs keep v2 marker |
| **2** | Manifests + artifact validation | Packaging scripts + portal scanners | Keep prior store ZIP obsolete; do not upload |
| **3** | Correlation + Sentry | Backend ingress + extension diagnostics consent | Kill switch; default-off remains safe |
| **4** | Support + issue routing | Hosted form + Postgres outbox | Disable route; retain accepted reports |
| **5** | Aggregate product analytics | Backend buckets only | Default-off; drop events |
| **6** | Public package boundary | `streamclone-pulse/packages` | Keep packages private until distribution acceptance + owner publish auth |
| **7** | Public-readiness + governance | LICENSE, SECURITY, rulesets, history audit | Visibility conversion is **irreversible checkpoint** |

---

## Irreversible checkpoints (owner approval required)

Stop and obtain **explicit** owner authorization before:

1. Credential rotation that invalidates live secrets.
2. History rewrite, force-push, or mass branch deletion.
3. Actions run / artifact / cache deletion campaigns.
4. Repository **visibility** conversion (private → public).
5. npm publish / trusted publishing enablement.
6. Chrome Web Store / Edge / Firefox store upload or submission.
7. Hosted deploy / migration apply / production env mutation.
8. Ruleset activation that could lock out admins (test break-glass first).
9. Any commit/push/PR opening from agents (default: **no** until owner asks).

---

## Release gates (must all pass)

No public visibility or store submission until:

- [ ] Clean clone builds with **no** sibling/private dependencies or tokens
- [ ] Local and **remote** CI pass at the **same** SHA (CI execution restored)
- [ ] Request matrix + explicit-Full tests pass
- [ ] Extension diagnostics and analytics remain default off (once implemented)
- [ ] Support is challenge-bound and durable (outbox) — or interim verified contacts only
- [ ] Privacy / CWS disclosures match every **actual** data flow and processor
- [ ] Final ZIP has no localhost, secrets, source maps, private paths, or remote code
- [ ] Package tarballs pass clean-consumer tests
- [ ] Retained refs and historical Actions surfaces are audited
- [ ] Media rights / provenance documented
- [ ] Branch protection rules tested without owner lockout
- [ ] Dedicated support/security channels verified **or** interim contact policy approved by owner

---

## Live checklist (one in-progress item)

| ID | Item | Status |
|----|------|--------|
| RPR-0 | Baseline + documentation consistency | **COMPLETE** |
| RPR-1 | Request matrix + chart migration v2 + coalesce | **COMPLETE** (pre-cutover archive force-full [`30147485091`](https://github.com/Aron-Chu/streamclone-pulse-private-archive/actions/runs/30147485091) on `da19e6e`) |
| RPR-2 | Manifest generation + package validation | **COMPLETE** (same archive proof; artifacts not uploaded) |
| RPR-3 | Correlation IDs + sanitized extension diagnostics | **implementation complete; activation pending** |
| RPR-4 | Hosted support form + outbox + minimal tracker fields | **implementation complete; activation pending** |
| RPR-5 | Aggregate product analytics (default off) | **implementation complete; activation pending** |
| RPR-6 | Pulse-owned public packages | **complete** |
| RPR-7 | Governance + clean public export | **complete** (see cutover evidence) |
| RPR-8 | Ruleset + break-glass | **active** ([`ruleset-recovery.md`](./ruleset-recovery.md)) |
| RPR-9 | Publication / store gates | **public-source cutover complete; store release pending** |

### CI fork / private-package limitation (removed by RPR-6 source ownership)

RPR-6 moves `@streampulse/*` packages into in-repo `packages/*`, so extension and
portal CI no longer require `STREAMPULSE_BACKEND_CHECKOUT_TOKEN` or a private
`streampulse-backend` checkout for package resolution.

**Owner note:** `STREAMPULSE_BACKEND_CHECKOUT_TOKEN` is **retired and removed**
from the cutover surface. Workflows must not read it.

Fork PRs can resolve the same in-repo packages as same-repo PRs. Continue to
review executable changes carefully; still **never** use `pull_request_target`.

RPR-6 package-distribution acceptance is **closed** (tarball consumers,
NOTICE/LICENSE distribution, `test:packages` CI, clean-checkout proof).

### RPR-0 sub-gates

- [x] Clean worktree based on authoritative baseline
- [x] Requirement ID collision fixed (R13 emote preserved; R14–R18 for RPR)
- [x] Public docs free of machine paths / private ops details (changed Phase 0 set scanned)
- [x] Privacy/Support match current code (planned systems labeled planned)
- [x] Interim contact policy: `privacy@streampulse.stream` only (support@ / security@ withheld until verified)
- [x] CWS historical vs next-candidate docs reconciled; **dashboard Support URL confirmation deferred to RPR-9**
- [x] Full local typecheck/test/build on clean worktree
- [x] Remote CI green on Phase 0 SHA (force-full jobs executed)

### Deferred release gates (remaining)

- Dedicated product-support mailbox (or explicit owner decision to keep interim policy)
- Dedicated `security@` mailbox (PVR is enabled; mailbox still unverified)
- CWS publisher-console Support URL confirmation (`https://streampulse.stream/support`)
- Store upload (RPR-9 remaining) — visibility conversion is **done**

---

## Residual risks (Phase 0)

- Remote CI may be non-executing until the owner restores account CI execution.
- Unverified mailbox names must not be published as active channels.
- Locked historical CWS ZIP bytes remain obsolete for upload after privacy/manifest program changes.
- Making Pulse public without scrubbing Actions artifacts/logs would expose historical private surfaces.

---

## Next hard gate

1. Keep **RPR-3/4/5 activation pending** — contracts frozen in [`contracts/`](./contracts/README.md); flags stay off. **PostHog** remains the locked RPR-5 processor (server aggregates only).  
2. Owner confirms CWS Support URL `https://streampulse.stream/support` and mocked screenshot retention before any store RC.  
3. Produce a version-bumped store release candidate (ZIPs + checksums + draft GitHub release) — **stop before CWS/Edge upload**.  
4. Verified mailbox today: **`privacy@` only**. Security: **PVR enabled**.  
5. Do **not** upload store ZIPs until explicit owner store authorization.  
6. Do **not** enable diagnostics / Turnstile / Linear / email / PostHog product analytics without a separate activation program.
