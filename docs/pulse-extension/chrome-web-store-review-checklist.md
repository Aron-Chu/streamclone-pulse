# Chrome Web Store review checklist (StreamPulse)

Extension ships as **beta** via [`/docs#extension`](../../streampulse-web/src/routes/public/Docs.tsx) until the store listing is approved.

Product name (user-facing): **StreamPulse**  
Privacy policy URL: `https://streampulse.stream/privacy` (live — Limited Use + `privacy@streampulse.stream` verified 2026-07-19)  
Backend: **streampulse-backend** / hosted `https://api.streampulse.stream`  
Local BFF (dev opt-in only): `http://localhost:8081` — never Streamclone watch `:8090`

Listing paste pack: [`chrome-web-store-listing.md`](./chrome-web-store-listing.md)  
Store screenshots: [`cws-screenshots/`](./cws-screenshots/) (1280×800)

Candidate branch for this pack: `codex/cws-listing-2026-07-19` @ `origin/master` tip (post Peak icons + portal honesty).

Legacy identifiers: [`legacy-identifiers.md`](./legacy-identifiers.md).

## Pre-submit

- [x] `npm test` + `npm run typecheck` + `npm run package:cws` pass on security gap-closure candidate (2026-07-20) — zip SHA-256 `0fc58f0df206ca149584240cb428e089fdad70e6b319d1012d2b7db60d89ef50`
- [x] Content-script debug persistence goes through service-worker messaging after `storage.local` `TRUSTED_CONTEXTS` (see `tests/pulseDebugStorage.test.ts`)
- [ ] **Unpacked smoke (required before CWS submit):** Load `dist/` → chrome://extensions Reload → hard-refresh a Twitch channel tab → enable debug logging in options → confirm overlay still mounts and no console storage-access errors
- [x] `host_permissions` includes `https://api.streampulse.stream/*`
- [x] Emote CDNs declared (`cdn.7tv.app`, `static-cdn.jtvnw.net`, `cdn.frankerfacez.com`)
- [x] Localhost BFF hosts are **optional_host_permissions** only
- [x] Runtime messages validated before SW handling (`parseBackgroundRequest`)
- [x] Emote image fetch restricted to HTTPS approved CDNs + image MIME + size/timeout limits
- [x] No secrets in extension bundle (beta keys entered in options UI only; stored in `chrome.storage.local`)
- [x] Content scripts use `chrome.runtime.sendMessage` only — no `fetch` under `src/content`
- [x] Privacy policy URL live and matches product (`/privacy`)
- [x] Dedicated privacy email published: `privacy@streampulse.stream`
- [x] Screenshots: overlay beside chat, settings, honest warming/coverage, expanded panel, stream recap (`cws-screenshots/`)
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
npm run package:cws
# artifacts (gitignored):
#   streampulse-extension.zip
#   streampulse-extension.zip.sha256
```

Regenerate store screenshots:

```powershell
powershell -File scripts/gen-cws-screenshots.ps1
```

## Post-approval

- [ ] Update `Landing.tsx` CTA from `/docs#extension` to store URL
- [ ] Keep beta key + optional localhost path for self-host / local `:8081` debugging

## Human / ops (remain open)

- [ ] Operator: paste listing + upload zip/screenshots + submit in Chrome Web Store Dashboard
- [ ] Ops: capacity remains HOLD_AT_300; no marketing blast without sign-off
- [ ] Ops: Cloudflare Access for `/v1/admin/pulse*` still recommended before marketing
