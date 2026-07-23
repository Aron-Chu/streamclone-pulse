# Chrome Web Store review checklist (StreamPulse)

Extension ships as **beta** via [`/docs#extension`](../../streampulse-web/src/routes/public/Docs.tsx) until the store listing is approved.

Product name (user-facing): **StreamPulse**  
Privacy policy URL: `https://streampulse.stream/privacy` (live — Limited Use + `privacy@streampulse.stream` verified 2026-07-19)  
Support URL: `https://streampulse.stream/support`  
Backend: **streampulse-backend** / hosted `https://api.streampulse.stream`  
Local BFF (dev opt-in only): `http://localhost:8081` — never Streamclone watch `:8090`

Listing paste pack: [`chrome-web-store-listing.md`](./chrome-web-store-listing.md)  
Store screenshots: [`cws-screenshots/`](./cws-screenshots/) (1280×800)

### Traceability (this pack)

| Field | Value |
|-------|--------|
| Branch | `codex/cws-live-screenshots-2026-07-19` |
| `PACKAGE_BUILD_COMMIT` | `e238cab9919af958e03c93d229338eda060517a2` (artifact commit; `npm run package:cws` ran from this tip) |
| ZIP | `streampulse-extension.zip` (gitignored) |
| ZIP SHA-256 | `725ad432b697c4b6531c5a598fc5822373c3675ad45e9414064e8e4c514c7f13` |
| Gates (2026-07-22) | `typecheck` OK · `npm test` **473**/473 · `test:e2e:mocked` **18**/18 · `package:cws` + `validate:package` OK |

The SHA identifies **exact ZIP bytes**. Do not regenerate the zip after the hash is locked (`scripts/zip-dist.mjs` does not guarantee byte-identical archives across runs/tools). Docs-only commits after packaging do not alter the packaged extension.

Portal install CTA stays **`pending_verification`** until Google approves the listing — no Landing store-URL flip and no Pages deploy from this pack.

Legacy identifiers: [`legacy-identifiers.md`](./legacy-identifiers.md).

## Pre-submit

- [x] `npm test` + `npm run typecheck` + `npm run test:e2e:mocked` + `npm run package:cws` pass on `PACKAGE_BUILD_COMMIT` (2026-07-22) — zip SHA-256 `725ad432b697c4b6531c5a598fc5822373c3675ad45e9414064e8e4c514c7f13`
- [x] `host_permissions` includes `https://api.streampulse.stream/*`
- [x] Emote CDNs declared (`cdn.7tv.app`, `static-cdn.jtvnw.net`, `cdn.frankerfacez.com`)
- [x] Localhost BFF hosts are **optional_host_permissions** only
- [x] Runtime messages validated before SW handling (`parseBackgroundRequest`)
- [x] Emote image fetch restricted to HTTPS approved CDNs + image MIME + size/timeout limits
- [x] No secrets in extension bundle (beta keys entered in options UI only; stored in `chrome.storage.local`)
- [x] Content scripts use `chrome.runtime.sendMessage` only — no `fetch` under `src/content`
- [x] Privacy policy URL live and matches product (`/privacy`)
- [x] Support URL live: `https://streampulse.stream/support`
- [x] Dedicated privacy email published: `privacy@streampulse.stream`
- [x] Screenshots (upload order): live Pulse panel → stream activity chart → Pulse duo → moments + chart → Stream Recap (`cws-screenshots/01-…05-…` names below)
- [x] Single purpose documented in listing pack
- [x] **Icon artwork:** Peak mark PNGs at exact 16/48/128; package validator enforces PNG signature + dimensions + non-stub size

## Permissions (current candidate)

Required `permissions`: `storage`, `scripting`

Required `host_permissions`:

- `https://api.streampulse.stream/*` — Pulse BFF
- `https://cdn.7tv.app/*`, `https://static-cdn.jtvnw.net/*`, `https://cdn.frankerfacez.com/*` — emote images
- `https://gql.twitch.tv/*` — stream/VOD identity GraphQL from page inject
- `https://*.twitch.tv/*` — Twitch page access for content script / tab messaging under host grant

Optional `optional_host_permissions`:

- `http://localhost:8081/*`, `http://127.0.0.1:8081/*` — local StreamPulse BFF opt-in

`tabs` permission: **removed**.

## Chrome Web Store

- [x] Permission justifications drafted in [`chrome-web-store-listing.md`](./chrome-web-store-listing.md)
- [x] Remote code: none (bundled JS only) — declare “No” remote hosted code
- [x] Data use disclosure drafted (aggregates from hosted API; settings in sync; beta key in local; session cache; optional debug logs)
- [x] Limited Use compliance on privacy page + listing pack
- [x] Store listing name / screenshots say **StreamPulse** (not Streamclone Pulse)
- [ ] Listing / submission / Google approval — **operator action in Developer Dashboard**

## Firefox (AMO)

- [ ] `browser_specific_settings.gecko.id` stable across releases (not configured yet)
- [ ] Same host permission set as Chrome
- [ ] Source upload / reproducible build notes if AMO requests them

## Packaging

```bash
# From PACKAGE_BUILD_COMMIT only — then preserve those exact ZIP bytes.
npm run package:cws
# artifacts (gitignored):
#   streampulse-extension.zip
#   streampulse-extension.zip.sha256
```

Store screenshots (operator upload order):

1. `01-live-pulse-panel-1280x800.png`
2. `02-stream-activity-chart-1280x800.png`
3. `03-pulse-duo-1280x800.png`
4. `04-moments-and-chart-1280x800.png`
5. `05-stream-recap-1280x800.png`

Recapture from packaging `dist/` (do not use the retired PowerShell compositor):

```bash
node scripts/capture-cws-pulse-screenshot.mjs --shot=all
```

## Post-approval

- [ ] Update `Landing.tsx` CTA from `/docs#extension` to store URL (and leave `pending_verification` until then)
- [ ] Keep beta key + optional localhost path for self-host / local `:8081` debugging

## Human / ops (remain open)

- [ ] Operator: paste listing + upload **this** zip (SHA above) + five screenshots + submit in Chrome Web Store Dashboard
- [ ] Ops: capacity remains HOLD_AT_300; no marketing blast without sign-off
- [ ] Ops: Cloudflare Access for `/v1/admin/pulse*` still recommended before marketing
