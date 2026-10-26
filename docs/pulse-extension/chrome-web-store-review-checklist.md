# Chrome Web Store review checklist (StreamPulse)

Product name (user-facing): **StreamPulse**
Privacy policy URL: `https://streampulse.stream/privacy`
Support URL: `https://streampulse.stream/support`
Backend (hosted): `https://api.streampulse.stream`
Local BFF (development manifest only): `http://localhost:8081` — never Streamclone watch `:8090`

Listing paste pack: [`chrome-web-store-listing.md`](./chrome-web-store-listing.md)
Release policy: [`release.md`](./release.md)
Reliability plan: [`reliability-public-release-plan.md`](./reliability-public-release-plan.md)

---

## A. Historical / published facts (verify in publisher console)

Do **not** treat this section as permission to upload a new package.

| Field | Status |
|-------|--------|
| Listing URL | https://chromewebstore.google.com/detail/streampulse/nifgoonpcgmdhiffcpmhndjgkgahnelg (HTTP 200 observed) |
| Extension ID | `nifgoonpcgmdhiffcpmhndjgkgahnelg` |
| Dashboard Support URL | **Owner must confirm** in Chrome Web Store Developer Dashboard. Public scrape is not authoritative for the Support URL field. |
| Website install CTAs | Use listing URL above when configured (`streampulse-web` public site config) |
| Privacy / Support site pages | Live routes on `streampulse.stream` |

Portal install CTA may remain `pending_verification` until the owner decides the public CTA matches the approved listing state. Do not invent “approved / live / beta” claims beyond what the dashboard shows.

### Historical obsolete package (audit trail only)

| Field | Value |
|-------|--------|
| Prior package commit | `ada58beb620a0955030528f46a5bc66e3c3010cb` |
| ZIP SHA-256 | `ae8d9b835d8459e4b886fad6948e903d6c0c9bae035119ad018cd42fbb253075` |
| Status | **Obsolete for upload.** Privacy/support/manifest program changes invalidate it. |

Keep the hash only as a historical audit record. Never instruct anyone to upload those bytes.

---

## B. Next RPR release candidate (all gates unchecked)

Build a **new** candidate only after RPR-2 validation gates. Every gate below starts unchecked for the next candidate.

### Pre-submit (next candidate)

- [ ] Clean clone from the release SHA (no sibling private deps)
- [ ] `npm run typecheck`, `npm test`, `npm run build`
- [ ] Mocked Playwright / packaging checks as applicable for that SHA
- [ ] Remote CI executes jobs and is green on the **same** SHA
- [ ] `npm run package:cws` (atomic) or `validate:package:cws` for the **store** target
- [ ] Store package contains **no** `localhost` / `127.0.0.1` host permissions
- [ ] Development-only local BFF access lives in a **separate development manifest** (RPR-2 / R18)
- [ ] Privacy and Support URLs match live pages and **current** disclosures
- [ ] Every route linked by the extension returns the intended live portal page, including supporter, account, policy, changelog, and community (`/feedback`, `/discord`) routes
- [ ] `https://streampulse.stream/discord` returns 200 **and** forwards to the Discord invite, not the "isn't open yet" page: the portal `/discord` route (PR #71) is merged and deployed with a valid invite. Until then the extension's Discord entry points (popup row, Settings Community card) must not ship
- [ ] `https://streampulse.stream/feedback` is deployed (portal before extension) and returns 200. The private feedback form may stay off (owner decision D19): the page then says the form is closed and offers public alternatives, each labelled public. While the form is off, the build keeps `FEEDBACK_FORM_LIVE` false (`src/shared/feedbackPolicy.ts`), so the Settings Community card's "Send feedback" link reads "Ideas or problems" and makes no privacy promise. Only a build made after the form is on may set it true, which changes that subline to "Private to the team"
- [ ] Contact disclosures use only verified mailboxes (today: `privacy@streampulse.stream`)
- [ ] Screenshots match the packaged `dist/` for that SHA
- [ ] Owner authorizes upload; candidate `0.2.5` exceeds the confirmed dashboard version (the public listing reported `0.2.1` on 2026-09-24; verify the dashboard and the owner-reviewed candidate scope)
- [ ] Published `0.2.1` source revision is **unverified** (no commit or tag sets 0.2.1; no attested 0.2.x artifact). Do not present any commit or local ZIP as that package
- [ ] Support URL / dashboard state rechecked by owner (do not claim dashboard changes from this checklist)
- [ ] Real unpacked-extension Twitch smoke recorded for the release SHA (mocked Playwright is not live evidence)
- [ ] Do **not** upload historical ZIP SHA `ae8d9b835d8459e4b886fad6948e903d6c0c9bae035119ad018cd42fbb253075`

### Permissions expected for the next **store** artifact

Required `permissions`: `storage`, `scripting`

Required `host_permissions` (store):

- `https://api.streampulse.stream/*`
- `https://*.twitch.tv/*` (covers Twitch page hosts used for injection/messaging; GQL discovery runs in page MAIN world — there is no separate `https://gql.twitch.tv/*` entry)

No emote or image CDN hosts: the panel shows those images as plain `<img>`
elements, which need no host permission.

**Must not appear** in the store artifact:

- `http://localhost:8081/*`
- `http://127.0.0.1:8081/*`
- any other local origins
- a separate `https://gql.twitch.tv/*` host permission entry (do not document one as required)

> **Note:** Development packages may list optional localhost hosts and are explicitly non-uploadable. Do not paste localhost justifications into the next store submission.

### Chrome Web Store dashboard (next candidate)

- [ ] Permission justifications pasted only for permissions present in the store ZIP
- [ ] Remote code: “No”
- [ ] Data use disclosure matches Privacy page (current behavior)
- [ ] Authentication information: disclose the invite-only device link. An invited tester links the extension with a one-time code; an opaque device credential is then kept in extension storage and sent only to `api.streampulse.stream`. Everyone else: none. (Same as the listing's Privacy practices table.)
- [ ] Analytics: none in this build. Product analytics and crash diagnostics are off (`EXTENSION_ANALYTICS_INGEST_ENABLED` and `EXTENSION_DIAGNOSTICS_INGEST_ENABLED` are `false`) and settings hides their toggles. Revisit this line in the build that turns either on.
- [ ] Limited Use affirmed
- [ ] Listing name / screenshots say **StreamPulse**
- [ ] Listing / submission / Google approval — owner action only
- [ ] Publisher-dashboard version + Support URL rechecked by owner (public listing `0.2.1` still linked Support to Twitch on 2026-09-24; set the dashboard field to `https://streampulse.stream/support`; do not claim dashboard edits from repo docs)

### Packaging commands (next candidate)

```bash
# From the release SHA only — store targets (atomic preferred).
npm run package:cws
# or: npm run validate:package:cws
# artifacts (gitignored; not uploaded):
#   streampulse-extension-cws-<version>.zip
#   streampulse-extension-cws-<version>.zip.sha256
#   streampulse-extension-cws-<version>.validation.json

npm run package:edge
# or: npm run validate:package:edge
# artifacts (gitignored; not uploaded):
#   streampulse-extension-edge-<version>.zip
#   streampulse-extension-edge-<version>.zip.sha256

# Development only — NOT uploadable:
npm run package:development
npm run validate:package
```

Do not regenerate or bless the obsolete historical ZIP.

### Firefox (AMO) — later

- [ ] `browser_specific_settings.gecko.id` stable across releases
- [ ] Same host permission set as Chrome store target (no localhost)
- [ ] Source upload / reproducible build notes if AMO requests them

---

## Existing package-validation work

This checklist **extends** existing `package:cws` / `validate:package:cws` work. Do not claim those scripts are absent. Harden them under RPR-2 to reject localhost on store targets and to continue rejecting secrets, source maps, and remote code. Never follow `package:cws` with development `validate:package`.
