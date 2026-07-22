# Chrome Web Store listing copy — StreamPulse

**Status:** Published in the Chrome Web Store
**Listing:** https://chromewebstore.google.com/detail/streampulse/nifgoonpcgmdhiffcpmhndjgkgahnelg
**Extension ID:** `nifgoonpcgmdhiffcpmhndjgkgahnelg`
**Package:** `npm run package:cws` → `streampulse-extension.zip` (+ `.sha256`)  
**Privacy policy:** https://streampulse.stream/privacy  
**Privacy contact:** privacy@streampulse.stream  
**Manifest name:** StreamPulse  
**Version (current package):** 0.1.0  

Do **not** use “Streamclone Pulse” in store-facing fields.

---

## Store listing fields

### Item name
```
StreamPulse
```

### Summary (short; ≤132 chars recommended)
```
Live Pulse overlay for Twitch — chat & emote activity, coverage honesty, moments — powered by the StreamPulse API.
```

### Detailed description
```
StreamPulse adds a live analytics overlay to Twitch so you can see chat and emote activity, coverage state, and standout moments without leaving the stream.

What you get
• Live Pulse chart docked beside Twitch chat (CHAT/PULSE sidebar when chat is open)
• Honest coverage and backfill status from the StreamPulse backend (no fake progress)
• Selected-moment / top-emote context for the current window
• Settings for theme, placement, and chart preferences
• Works with Twitch channel and VOD pages

How it works
The extension reads the Twitch page context to identify the channel / stream / VOD, then the service worker calls the StreamPulse API (https://api.streampulse.stream) for minute-level aggregates. Raw chat is not shown in the overlay. Scoring and rollups come from the backend — the extension does not invent Pulse scores client-side.

Privacy
See https://streampulse.stream/privacy — including Chrome Web Store Limited Use language and contact privacy@streampulse.stream.

Public access
The extension is public-first. It does not require Twitch OAuth or a StreamPulse beta/access key.

Support
Privacy & support: privacy@streampulse.stream
Product docs: https://streampulse.stream/docs#extension
```

### Category
`Productivity` (or `Social & Communication` if Dashboard forces a closer match — prefer Productivity)

### Language
English (United States)

---

## Graphic assets (this repo)

| Asset | Path | Size |
|-------|------|------|
| Screenshots (required) | `store/cws/screenshots/{01-live-pulse,02-coverage,03-vod-replay,04-most-reacted}.png` | 1280×800 |
| Small promo tile (optional) | `store/cws/icons/small-promo-440x280.png` | 440×280 |
| Store icon | `store/cws/icons/icon128.png` | 128×128 RGBA |

Regenerate the validated mocked screenshot set with:
```bash
npx playwright test --project=extension-mocked tests/e2e/specs/cws-extension-screenshots.mocked.spec.ts
```

Suggested upload order:
1. Live Pulse overview
2. Honest coverage state
3. VOD Replay Pulse
4. Most reacted region

---

## Permission justifications (paste into Dashboard)

### storage
```
Stores StreamPulse settings (theme, overlay placement, chart preferences, and watchlist) in chrome.storage.sync, optional bounded diagnostic logs in chrome.storage.local, and short-lived Pulse/coverage cache in chrome.storage.session so the overlay can restore preferences and avoid unnecessary API calls. The extension does not store or transmit a beta/access key.
```

### scripting
```
Injects the StreamPulse content script on Twitch pages so the overlay can mount beside chat and read page context needed to identify the current channel, live stream, or VOD for Pulse coverage.
```

### Host permission — https://api.streampulse.stream/*
```
Calls the StreamPulse backend for Pulse rollups, coverage/backfill state, and related analytics shown in the overlay. This is the default production API.
```

### Host permission — https://cdn.7tv.app/*, https://static-cdn.jtvnw.net/*, https://cdn.frankerfacez.com/*
```
Loads emote images displayed in the overlay from approved HTTPS CDNs only (7TV, Twitch CDN, FrankerFaceZ).
```

### Host permission — https://gql.twitch.tv/*
```
Resolves stream/VOD identity via Twitch GraphQL from the page context so coverage and backfill flows target the correct broadcast.
```

### Host permission — https://*.twitch.tv/*
```
Runs the content script on Twitch channel and VOD pages and allows tab messaging under the Twitch host grant (no broad tabs permission).
```

### Optional — http://localhost:8081/*, http://127.0.0.1:8081/*
```
Developer opt-in only: local StreamPulse BFF for debugging. Not required for normal store users; requested only when the user enables a local backend override.
```

---

## Data safety / disclosure checklist (Dashboard)

| Question | Answer |
|----------|--------|
| Collects user data? | Yes — limited: channel/stream/VOD identifiers sent to StreamPulse API; settings in Chrome storage |
| Sold to third parties? | No |
| Used for ads / unrelated profiling? | No |
| Remote hosted code? | **No** — bundled JS only |
| Authentication information? | **No** — no Twitch OAuth and no StreamPulse beta/access key |
| Privacy policy URL | https://streampulse.stream/privacy |
| Limited Use | Affirmed on privacy page + this listing |

---

## Single purpose

```
Provide a Twitch live/VOD Pulse analytics overlay powered by the StreamPulse API.
```

---

## Published listing status

- [x] Version `0.1.0` is published at the canonical listing URL above.
- [x] Website install CTAs use the canonical listing URL.
- [x] Privacy and Support pages are live on `streampulse.stream`.
- [x] The public-first build has no beta/access-key setting or request header.
- [ ] **Manual account correction:** change the CWS Support URL from the Twitch channel currently shown by the listing to `https://streampulse.stream/support`.
- [ ] Optional: replace the validated mocked screenshot set only after a reviewed live-Twitch capture.

Do not upload a replacement package without separate authorization. A code update requires a
version greater than `0.1.0`, a newly validated ZIP, and Chrome Web Store review.
