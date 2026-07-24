# StreamPulse — Reliability, Public Release, and Repository Governance

**Status:** Phase 0 **complete** (documentation + CI economy landed; exact-SHA force-full verified).  
**Canonical execution plan** for the reliability / public-release / governance program.  
Companion ledgers: [`tasks.md`](./tasks.md) (`RPR-*`), [`requirements.md`](./requirements.md) (R14–R18 for new gates; **R13 remains Emote metadata readiness**), [`design.md`](./design.md), [`release.md`](./release.md).

---

## Authoritative baseline

| Fact | Value |
|------|--------|
| Remote | `https://github.com/Aron-Chu/streamclone-pulse.git` |
| Phase 0 verified master | `69b357521d6794410da3267e8699c13012f88351` |
| Working rule | Implement only from a clean checkout/worktree of that SHA (or a descendant). Do not mutate unrelated dirty checkouts. |
| Remote CI gate | Remote workflow runs must **execute jobs successfully** on the release SHA. Runs that start no jobs do not count as green. |

**Hard rule:** Never make `streamclone-pulse` public merely to obtain free Actions. Remote green CI from the **exact** implementation SHA is a mandatory publication gate.

---

## Locked product decisions

1. **Chart range migration v2 (planned R14):** Existing chart preferences (including `Full`) migrate once to `60m` under a v2 marker. A user who selects `Full` after v2 keeps it.
2. **Full history fetch (planned R14):** Only after explicit user action. Recurring polling always uses recent windows.
3. **Polling ownership (planned R14):** Content scripts own tab-scoped polling. Service worker brokers, caches, and coalesces. Do **not** add `chrome.alarms` unless no-tab durable polling becomes an explicit requirement.
4. **Twitch hosts:** Preserve the two Twitch hosts. Remote master already routes `sidebarPart="tabs"` to lightweight `OverlayTabsShell`; do not recreate obsolete dual-effect-controller fixes.
5. **Consent (planned R15):** Extension diagnostics and product analytics have separate versioned, **default-off** consent. No durable install/session identifier. Portal Sentry (when `VITE_SENTRY_DSN` is set) is a separate, existing website path — not extension consent.
6. **Support (planned R16):** Extension Help will open a hosted StreamPulse form with Turnstile; no remote challenge script in the MV3 package. **Not implemented yet.**
7. **Manifests (planned R18):** Store manifests contain **no** localhost permission. Development manifests may contain `localhost:8081`.
8. **Packages (planned R17):** Move `pulse-core`, `pulse-charts`, and `analytics-console` into `streamclone-pulse/packages` as public in-repo workspaces after provenance/license review. Backend remains private and consumes released versions where appropriate.
9. **License:** Pulse uses **Apache-2.0**.
10. **Visibility:** Only `streamclone-pulse` becomes newly public. Do **not** publicize `streampulse-backend`, `streampulse-ops`, `replayforge`, or `streampulse-sdlc`.

---

## Scope (allowed repos)

| Repo | Allowed work |
|------|----------------|
| **streamclone-pulse** | Extension, portal, public client packages, docs, CI, public-release candidate |
| **streampulse-backend** | Private APIs, correlation IDs, support outbox, telemetry proxies, package-consumer changes |
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
| **6** | Public package boundary | `streamclone-pulse/packages` | Keep packages on private backend until cutover authorized |
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
| RPR-1 | Request matrix + chart migration v2 + coalesce | pending |
| RPR-2 | Manifest generation + package validation | complete |
| RPR-3 | Correlation IDs + sanitized extension diagnostics | pending |
| RPR-4 | Hosted support form + outbox + minimal tracker fields | pending |
| RPR-5 | Aggregate product analytics (default off) | pending |
| RPR-6 | Pulse-owned public packages | pending |
| RPR-7 | Governance files + history/Actions audit | pending |
| RPR-8 | Ruleset + break-glass (post green CI) | pending |
| RPR-9 | Publication / store gates (owner-authorized) | pending |

### RPR-0 sub-gates

- [x] Clean worktree based on authoritative baseline
- [x] Requirement ID collision fixed (R13 emote preserved; R14–R18 for RPR)
- [x] Public docs free of machine paths / private ops details (changed Phase 0 set scanned)
- [x] Privacy/Support match current code (planned systems labeled planned)
- [x] Interim contact policy: `privacy@streampulse.stream` only (support@ / security@ withheld until verified)
- [x] CWS historical vs next-candidate docs reconciled; **dashboard Support URL confirmation deferred to RPR-9**
- [x] Full local typecheck/test/build on clean worktree
- [x] Remote CI green on Phase 0 SHA (force-full jobs executed)

### Deferred release gates (not Phase 0 blockers)

- Dedicated support/security mailboxes (or GitHub Private Vulnerability Reporting)
- CWS publisher-console Support URL confirmation
- Store upload / visibility conversion (RPR-9)

---

## Residual risks (Phase 0)

- Remote CI may be non-executing until the owner restores account CI execution.
- Unverified mailbox names must not be published as active channels.
- Locked historical CWS ZIP bytes remain obsolete for upload after privacy/manifest program changes.
- Making Pulse public without scrubbing Actions artifacts/logs would expose historical private surfaces.

---

## Next hard gate

1. Start **RPR-1** (request contract + chart migration v2 + coalesce) from verified master.  
2. Keep support/security mailbox verification and CWS dashboard confirmation as **RPR-9** release gates.  
3. Do **not** start RPR-3+ until RPR-1 and RPR-2 land.
