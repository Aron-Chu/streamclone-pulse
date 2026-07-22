# Chrome Web Store / AMO review checklist (StreamPulse)

Extension ships public-first for Twitch live/VOD Pulse analytics. Version `0.1.0`
is published at https://chromewebstore.google.com/detail/streampulse/nifgoonpcgmdhiffcpmhndjgkgahnelg.

## Pre-submit

- [x] Local RC verification: typecheck + unit tests + `package:cws` + mocked e2e (closeout 2026-07-21)
- [x] Screenshots: RC mocked 1280×800 set under `store/cws/screenshots/` (final visual approval + optional live capture remain manual)
- [x] Single purpose: Twitch live/VOD Pulse analytics overlay powered by StreamPulse hosted API
- [x] Peak store icon + small promo tile — `npm run icons:cws` (128×128 **RGBA** PNG; see `store/cws/README.md`)
- [ ] LIVE_TWITCH_SMOKE unpacked manual gate
- [x] Publisher contact is visible on the published listing
- [x] Version `0.1.0` upload and Chrome Web Store review completed
- [ ] Manual account correction: set the listing Support URL to `https://streampulse.stream/support`

## Chrome Web Store (paste-ready)

- **Single purpose:** Twitch live/VOD Pulse analytics overlay powered by StreamPulse hosted API.
- **Category:** Productivity
- **Language:** English
- **Host permission justification:** StreamPulse needs HTTPS access to Twitch pages to display its live/VOD analytics overlay and identify the current channel or video. It connects to the StreamPulse API for sanitized Pulse analytics and coverage data. Emote image assets are fetched by the service worker from approved CDN hosts (7TV, Twitch CDN / jtvnw, FrankerFaceZ). Optional local development may use a StreamPulse backend on localhost:8081 after the user grants optional host permission.
- **Remote code:** No. All executable JavaScript is packaged with the extension; no remote JavaScript or WebAssembly is downloaded or evaluated.
- **Scripting justification:** The extension uses bundled scripts to inspect the current Twitch page and resolve live/VOD metadata needed to display the Pulse overlay.
- **Storage justification:** The extension stores user-selected overlay settings, theme preferences, watchlist settings, short-lived caches, and optional local debug logs.
- **Authentication information:** No
- **Website content:** Active Twitch URL and stream/VOD metadata for the overlay only. Do not disclose raw chat, personal communications, location, financial information, health information, or authentication information.

## Permissions (audited)

- [x] `permissions`: `storage`, `scripting` only (no `tabs`)
- [x] Required `host_permissions`: hosted API + emote CDNs (7TV, jtvnw, FrankerFaceZ) + `https://gql.twitch.tv/*` + `https://*.twitch.tv/*`
- [x] `optional_host_permissions`: `http://localhost:8081/*`, `http://127.0.0.1:8081/*`
- [x] Content scripts: `https://*.twitch.tv/*` only
- [x] Remote code: none (bundled JS only)
- [x] Data use: aggregates from hosted API; no raw chat stored locally beyond UI/session cache

## Data categories to select

Select only what the build actually uses:

- Website content — active Twitch URL / page and stream or VOD metadata
- Do **not** select: personal communications, location, financial, health, authentication credentials, unless a fresh audit proves otherwise

## Firefox (AMO)

- [ ] `browser_specific_settings.gecko.id` stable across releases
- [ ] Same host permission set as Chrome
- [ ] Source upload / reproducible build notes if AMO requests them

## Account-only follow-up

- [ ] Correct the live listing Support URL to `https://streampulse.stream/support`
- [ ] Optional: review and promote a live-Twitch screenshot set

## Packaging

```bash
npm run package:cws
# artifacts (gitignored):
#   streampulse-extension.zip (or streamclone-pulse.zip from zip script)
```

Regenerate store icons / mocked release screenshots:

```bash
npm run icons:cws
npm run capture:cws:mocked
```

Live Twitch screenshots use a separate audited operator workflow and must not replace the
mocked release set without explicit visual review and promotion.

## Published integration

- [x] Website CTAs use the canonical Chrome Web Store listing URL
- [x] Public-first extension has no beta-key or access-key setting
