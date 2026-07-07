# Chrome Web Store / AMO review checklist (Streamclone Pulse)

Extension ships as **beta** via [`/docs#extension`](../../streampulse-web/src/routes/public/Docs.tsx) until store listings exist.

## Pre-submit

- [x] `npm test` + `npm run build` pass locally (2026-07-07)
- [x] `host_permissions` includes `https://api.streampulse.stream/*` (manifest.json)
- [ ] `cdn.streampulse.stream` — not required today (emotes via 7tv/jtv/ffz); add if proxy CDN used in listing
- [ ] No secrets in extension bundle (beta keys entered in options UI only)
- [ ] Content scripts use `chrome.runtime.sendMessage` — no direct `fetch` from content scripts
- [ ] Privacy policy URL on streampulse.stream covers device token + hosted API usage
- [ ] Screenshots: Twitch overlay docked beside chat, settings panel, honest partial-coverage state
- [ ] Single purpose: Twitch live/VOD Pulse analytics overlay powered by Streamclone backend

## Chrome Web Store

- [ ] MV3 service worker stays alive under review load (no long blocking sync work)
- [ ] `permissions`: `storage`, `scripting` only — justify `host_permissions` in listing text
- [ ] Remote code: none (bundled JS only)
- [ ] Data use disclosure: aggregates from hosted API, no raw chat stored locally beyond UI cache

## Firefox (AMO)

- [ ] `browser_specific_settings.gecko.id` stable across releases
- [ ] Same host permission set as Chrome
- [ ] Source upload / reproducible build notes if AMO requests them

## Post-approval

- [ ] Update `Landing.tsx` CTA from `/docs#extension` to store URL
- [ ] Keep beta key path for self-host / local `:8090` debugging
