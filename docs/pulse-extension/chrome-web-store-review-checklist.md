# Chrome Web Store review checklist (StreamPulse)

Extension ships as **beta** via [`/docs#extension`](../../streampulse-web/src/routes/public/Docs.tsx) until store listings exist.
Do **not** mark an item complete without evidence from this branch.

Product name (user-facing): **StreamPulse**
Privacy policy URL (after portal deploy): `https://streampulse.stream/privacy`
Backend owner: **streampulse-backend** (hosted default `https://api.streampulse.stream`)
Local BFF (dev opt-in only): `http://localhost:8081` — never Streamclone watch `:8090`

Legacy identifiers (package name, DOM ids, `X-Streamclone-Beta-Key`, etc.): see [`legacy-identifiers.md`](./legacy-identifiers.md).

## Pre-submit

- [ ] `npm test` + `npm run typecheck` + `npm run build` pass on release candidate branch
- [ ] `node --check scripts/zip-dist.mjs` + `npm run zip` + `npm run validate:package` pass
- [ ] CI uploads `streampulse-extension.zip` + `.sha256` artifact (not only `dist/`)
- [x] `host_permissions` includes `https://api.streampulse.stream/*` (manifest.json)
- [x] Emote CDNs declared (`cdn.7tv.app`, `static-cdn.jtvnw.net`, `cdn.frankerfacez.com`)
- [x] Localhost BFF hosts are **optional_host_permissions** only (not required for CWS)
- [ ] No secrets in extension bundle (beta keys entered in options UI only; stored in `chrome.storage.local`)
- [ ] Content scripts use `chrome.runtime.sendMessage` — no direct `fetch` from content scripts
- [ ] Privacy policy URL on streampulse.stream is live and matches this candidate (`/privacy`)
- [ ] Dedicated privacy email published (interim public contact on `/privacy` is https://github.com/Aron-Chu/streamclone-pulse/issues; dedicated email remains a CWS blocker)
- [ ] Screenshots: Twitch overlay docked beside chat, settings panel, honest partial-coverage state
- [ ] Single purpose: Twitch live/VOD Pulse analytics overlay powered by StreamPulse API (`streampulse-backend`)

## Permissions (current candidate)

Required `permissions`: `storage`, `scripting`

Required `host_permissions`:

- `https://api.streampulse.stream/*` — Pulse BFF
- `https://cdn.7tv.app/*`, `https://static-cdn.jtvnw.net/*`, `https://cdn.frankerfacez.com/*` — emote images
- `https://gql.twitch.tv/*` — stream/VOD identity GraphQL from page inject
- `https://*.twitch.tv/*` — Twitch page access for content script / tab messaging under host grant

Optional `optional_host_permissions`:

- `http://localhost:8081/*`, `http://127.0.0.1:8081/*` — local StreamPulse BFF opt-in

`tabs` permission: **removed**. `chrome.tabs.query` / `sendMessage` / `onUpdated` / `create` rely on Twitch host permissions for URL access, not the broad `tabs` permission. Re-add only if unpacked smoke proves a broken API without it, and document the exact call site.

## Chrome Web Store

- [ ] MV3 service worker stays alive under review load (no long blocking sync work)
- [ ] Permission justifications in listing match the table above
- [ ] Remote code: none (bundled JS only) — declare “No” remote hosted code
- [ ] Data use disclosure: aggregates from hosted API; settings in sync; beta key in local; session cache; optional debug logs in local when enabled
- [ ] Limited Use compliance affirmed in listing + privacy page
- [ ] Store listing name / screenshots say **StreamPulse** (not Streamclone Pulse)

## Firefox (AMO)

- [ ] `browser_specific_settings.gecko.id` stable across releases (not configured yet)
- [ ] Same host permission set as Chrome
- [ ] Source upload / reproducible build notes if AMO requests them

## Packaging

```bash
npm run package:cws
# artifacts:
#   streampulse-extension.zip
#   streampulse-extension.zip.sha256
```

## Post-approval

- [ ] Update `Landing.tsx` CTA from `/docs#extension` to store URL
- [ ] Keep beta key + optional localhost path for self-host / local `:8081` debugging

## Human / legal / ops (remain open)

- [ ] Sol / ops: Cloudflare Access proved for `/v1/admin/*`
- [ ] Sol / ops: capacity remains HOLD_AT_300; no marketing blast without sign-off
- [ ] Legal: dedicated privacy email published (public page interim link: github.com/Aron-Chu/streamclone-pulse/issues)
- [ ] Operator: screenshots + store listing copy + submission
