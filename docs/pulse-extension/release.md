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
6. **Public-source cutover is complete** (`Aron-Chu/streamclone-pulse` is public). Do not publicize backend/ops/archive. Store upload remains a separate owner gate.
7. **Public contacts** must stay truthful. Verified today: `privacy@streampulse.stream` + GitHub PVR. Unverified `support@` / `security@` must not be published as active.

---

## Manifest targets (RPR-2 / R18 — landed; upload still RPR-9)

| Target | Localhost hosts | Purpose |
|--------|-----------------|---------|
| Development | May include `http://localhost:8081/*` / `127.0.0.1:8081` (optional) | Local BFF debugging |
| CWS | **None** | Chrome Web Store |
| Edge | **None** | Microsoft Edge Add-ons |
| Firefox (later) | **None** | AMO |

Generation must not broaden production permissions beyond the audited set.
`package:cws` / `package:edge` (atomic) and `validate:package:cws` /
`validate:package:edge` produce distinct ZIP names and run yauzl byte validation.
`validate:package` is the **development** target only and is not uploadable.
Do **not** upload until RPR-9.

Working-tree source version is **0.2.1** (selected-minute clarity / viewer honesty / complete
settings track). Manifests, `package.json`, and `src/shared/release-notes.json`
all read `0.2.1`. The public Chrome Web Store listing also reported **0.2.1**
on 2026-09-24 (updated 2026-09-01), so these newer working-tree changes cannot
be submitted under that same version. Select a higher version only after the
publisher dashboard version is confirmed and a new candidate is accepted.
The default chart range is **Full stream**
(`DEFAULT_DEFAULT_CHART_WINDOW = 'full'`, migration key
`defaultChartWindowMigratedToFullV3`). The earlier `60m` default and its
migration are historical and no longer describe shipped behaviour.
**Candidate acceptance: pending** — local closure WIP only; no store upload, tag, or hosted migrate in this pass.

The prior `0.1.3` reliability candidate was never uploaded. Its status record in
[`v0.1.3-reliability-status.md`](./v0.1.3-reliability-status.md) and the
`docs/evidence/` files remain historical provenance and are not rewritten.

**Do not upload attested `v0.1.2` / `v0.1.2-store` ZIPs** — they remain immutable
evidence only and include known player-jump defects. Never upload the older
unattested draft `49bf0a9e…` ZIP either.

Historical 0.1.2 assurance pointers (attested but unshipped):
- Store packaging tip `v0.1.2-store` → `96f0f3d19e88df15c9abc72edb69d69409e6f919`
- Immutable RC freeze `v0.1.2` → `2031f9c9f726c13b6351273d0975bb130b16910a`
- Evidence: `docs/evidence/RPR-9-0.1.2-assurance-20260726.md`,
  `docs/evidence/CWS-screenshot-provenance-v0.1.2.md`

Owner must confirm the live CWS dashboard version and that the dashboard Support
URL is `https://streampulse.stream/support/` before any new upload. The public
[listing](https://chromewebstore.google.com/detail/streampulse/nifgoonpcgmdhiffcpmhndjgkgahnelg)
reported **0.2.1** and linked Support to Twitch on 2026-09-24; only the
publisher dashboard is authoritative for the configured field. Stop before
tags/releases unless separately authorized; stop again before CWS/Edge upload.

Before candidate acceptance, retain evidence for all of the following instead
of inferring readiness from source state: local gates and executed remote CI on
the same release SHA, a reviewed store-target ZIP, a real unpacked-extension
Twitch smoke, publisher-dashboard version and Support URL checks, and an
owner-dispatched attested artifact. Mocked browser screenshots and a locally
built `dist/` do not satisfy the live or publisher-account gates.

Owner-dispatched attested packaging: `.github/workflows/release-artifacts.yml`
(inputs: exact `v<package-version>` tag + expected full SHA + completed same-SHA
`workflow_dispatch` CI run). The Actions run must also be dispatched with the
workflow ref selector set to that exact tag; a later checkout cannot repair an
incorrect OIDC source ref. Checksums are operator convenience only; GitHub
artifact attestations are the cryptographic provenance for final ZIPs.

---

## Package validation (required before next candidate)

`package:cws` / `package:edge` / `validate:package:cws` / `validate:package:edge` reject:

- Source maps, `.env*`, secrets, absolute/sibling paths (store targets)
- `file:` dependencies outside this repository (store targets; RPR-6 package-distribution acceptance covers clean-clone + tarball consumers)
- Remote executable code / unapproved archive entries
- Local origins (`localhost`, `127.0.0.1`, any port) in **store** packages

Portal production scanning must reject `localhost` and `127.0.0.1` on **every** port
(including 8081) in shipped JS/HTML.

`npm run build` writes `.artifacts/extension-build-provenance.json`, which is
**local-dist-build** provenance for the commit and hashed `dist/` files. It is
not provenance for a final store ZIP and does not replace the attestation
verification evidence emitted by `Release artifacts`. Produce checksums + build
metadata for operator verification, but do **not** claim self-generated
checksums or local build metadata as cryptographic provenance.

CWS screenshot evidence in this repository remains the historical v0.1.2 set;
this release policy does not claim regenerated v0.2.1 screenshots. The tracked
CWS screenshots under `store/cws/screenshots/` are regenerated as a side effect of
the mocked Playwright suite and must be reviewed before they are committed.

---

## Store upload checklist (next RPR candidate)

- [ ] Clean clone from release SHA (no sibling private deps)
- [ ] `npm test`, `npm run typecheck`, `npm run build`, mocked Playwright as applicable
- [ ] Remote CI green on that SHA (jobs actually executed)
- [ ] `npm run package:cws` (or `validate:package:cws`) for the store target; no localhost
- [ ] Privacy / Support URLs match live pages and **current** disclosures
- [ ] Every portal route linked by the extension returns the intended live page (including `/supporter`, account, policy, and changelog routes)
- [ ] Owner confirms the publisher-dashboard version and Support URL, selects a higher version than the published release, then authorizes upload
- [ ] Real unpacked-extension smoke on Twitch recorded for the release SHA
- [ ] Do **not** upload historical ZIP SHA `ae8d9b835d8459e4b886fad6948e903d6c0c9bae035119ad018cd42fbb253075`
- [ ] Do **not** upload until owner confirms dashboard Support URL + version gates in `docs/evidence/RPR-9-0.1.2-assurance-20260726.md`
- [ ] Upload digest must match the **attested** CWS ZIP from `Release artifacts` for the owner-approved `v<new-version>` tag (not a historical asset)

---

## Historical obsolete candidate (audit only)

ZIP SHA-256 `ae8d9b835d8459e4b886fad6948e903d6c0c9bae035119ad018cd42fbb253075` and packages
built before the RPR privacy/manifest program are **obsolete for upload**. Retain the
hash only as a historical audit record. It is not the current candidate.

---

## Rollback

- Store: halt rollout / unpublish only via publisher console (owner).
- Portal: prior Pages deployment via private ops runbooks.
- Extension prefs: chart migration v3 is one-way for legacy values; a post-migration explicit user window choice is preserved.
