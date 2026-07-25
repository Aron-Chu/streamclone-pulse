# StreamPulse extension — Release policy

Canonical release process for store packages and the public portal. Companion:
[`reliability-public-release-plan.md`](./reliability-public-release-plan.md),
[`chrome-web-store-review-checklist.md`](./chrome-web-store-review-checklist.md).

---

## Principles

1. **Hosted API default:** `https://api.streampulse.stream`. Local BFF (`http://localhost:8081`) is development-only.
2. **Store manifests omit localhost** entirely. Development manifests may declare optional `localhost:8081`.
3. **One SHA, one package.** Local gates and remote CI must pass on the same commit before upload. Workflow runs that execute no jobs do not count.
4. **Never upload an obsolete ZIP.** Manifest, privacy, support, or permission changes invalidate prior locked candidates.
5. **No agent push / store submit** without explicit owner authorization.
6. **Do not flip repo visibility** to obtain free Actions.
7. **Public contacts** must be verified before publication. Unverified mailboxes are release blockers (R18).

---

## Manifest targets (RPR-2 / R18 — landed; upload still RPR-9)

| Target | Localhost hosts | Purpose |
|--------|-----------------|---------|
| Development | May include `http://localhost:8081/*` / `127.0.0.1:8081` (optional) | Local BFF debugging |
| CWS | **None** | Chrome Web Store |
| Edge | **None** | Microsoft Edge Add-ons |
| Firefox (later) | **None** | AMO |

Generation must not broaden production permissions beyond the audited set.
`package:cws` / `package:edge` / `validate:package` produce distinct ZIP names and run
yauzl byte validation. Do **not** upload until RPR-9.

---

## Package validation (required before next candidate)

`package:cws` / `package:edge` / `validate:package` reject:

- Source maps, `.env*`, secrets, absolute/sibling paths (store targets)
- `file:` dependencies outside this repository (store targets; RPR-6 still blocks clean-clone publish)
- Remote executable code / unapproved archive entries
- Local origins (`localhost`, `127.0.0.1`, any port) in **store** packages

Portal production scanning must reject `localhost` and `127.0.0.1` on **every** port
(including 8081) in shipped JS/HTML.

Produce checksums + build metadata for operator verification. Do **not** claim
self-generated checksums as cryptographic provenance.

---

## Store upload checklist (next RPR candidate)

- [ ] Clean clone from release SHA (no sibling private deps)
- [ ] `npm test`, `npm run typecheck`, `npm run build`, mocked Playwright as applicable
- [ ] Remote CI green on that SHA (jobs actually executed)
- [ ] `npm run package:cws` + `validate:package` (store target; no localhost)
- [ ] Privacy / Support URLs match live pages and **current** disclosures
- [ ] Owner authorizes upload; version exceeds last published version
- [ ] Do **not** upload historical ZIP SHA `ae8d9b835d8459e4b886fad6948e903d6c0c9bae035119ad018cd42fbb253075`

---

## Historical obsolete candidate (audit only)

ZIP SHA-256 `ae8d9b835d8459e4b886fad6948e903d6c0c9bae035119ad018cd42fbb253075` and packages
built before the RPR privacy/manifest program are **obsolete for upload**. Retain the
hash only as a historical audit record. It is not the current candidate.

---

## Rollback

- Store: halt rollout / unpublish only via publisher console (owner).
- Portal: prior Pages deployment via private ops runbooks.
- Extension prefs: chart migration v2 is one-way for legacy values; post-v2 user `Full` choice is preserved.
