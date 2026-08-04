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
- [ ] Contact disclosures use only verified mailboxes (today: `privacy@streampulse.stream`)
- [ ] Screenshots match the packaged `dist/` for that SHA
- [ ] Owner authorizes upload; version exceeds confirmed dashboard version (source manifests are `0.1.3`; owner must verify the live listing is behind 0.1.3 before upload)
- [ ] Support URL / dashboard state rechecked by owner (do not claim dashboard changes from this checklist)
- [ ] Do **not** upload historical ZIP SHA `ae8d9b835d8459e4b886fad6948e903d6c0c9bae035119ad018cd42fbb253075`

### Permissions expected for the next **store** artifact

Required `permissions`: `storage`, `scripting`

Required `host_permissions` (store):

- `https://api.streampulse.stream/*`
- `https://cdn.7tv.app/*`, `https://static-cdn.jtvnw.net/*`, `https://cdn.frankerfacez.com/*`
- `https://*.twitch.tv/*` (covers Twitch page hosts used for injection/messaging; GQL discovery runs in page MAIN world — there is no separate `https://gql.twitch.tv/*` entry)

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
- [ ] Disclose optional one-time Protect enrollment: beta key is discarded, device token is local/trusted-only, and the token is revocable
- [ ] Distinguish browser-sync saved watchlist entries from server-confirmed Protect rows, including pending DELETE tombstones and backend retention
- [ ] Disclose separate default-off product analytics consent + PostHog server processing (no identity; ~180-day target) **without claiming activation**
- [ ] Limited Use affirmed
- [ ] Listing name / screenshots say **StreamPulse**
- [ ] Listing / submission / Google approval — owner action only
- [ ] Live listing version + Support URL rechecked by owner (source is `0.1.3`; do not claim dashboard edits from repo docs)

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
