# Chrome Web Store listing copy — StreamPulse

**Status:** Ready for operator paste into Chrome Web Store Developer Dashboard  
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

Beta / hosted access
Some hosted features may require an access key entered in Options (stored locally, not synced). The public site does not require a beta key for public analytics.

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
| Screenshots (required) | `docs/pulse-extension/cws-screenshots/01-…05-…png` | 1280×800 |
| Small promo tile (optional) | `docs/pulse-extension/cws-screenshots/promo-small-tile-440x280.png` | 440×280 |
| Store icons | packaged from `public/icons/icon{16,48,128}.png` | Peak mark |

Regenerate screenshots after Figma updates:
```powershell
powershell -File scripts/gen-cws-screenshots.ps1
```

Suggested upload order:
1. Overlay beside chat  
2. Expanded panel  
3. Settings  
4. Honest warming / coverage  
5. Stream recap  

---

## Permission justifications (paste into Dashboard)

### storage
```
Stores StreamPulse settings (theme, overlay placement, chart preferences, watchlist) in chrome.storage.sync, an optional beta/access key in chrome.storage.local, and short-lived Pulse/coverage cache in chrome.storage.session so the overlay can restore preferences and avoid unnecessary API calls.
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
| Privacy policy URL | https://streampulse.stream/privacy |
| Limited Use | Affirmed on privacy page + this listing |

---

## Single purpose

```
Provide a Twitch live/VOD Pulse analytics overlay powered by the StreamPulse API.
```

---

## Submission checklist (operator)

1. [ ] `npm test && npm run typecheck && npm run package:cws` on the release commit  
2. [ ] Upload `streampulse-extension.zip`  
3. [ ] Paste name / summary / description from this doc  
4. [ ] Upload 1280×800 screenshots from `cws-screenshots/`  
5. [ ] Paste permission justifications  
6. [ ] Set privacy URL + Limited Use / data disclosures  
7. [ ] Submit for review  
8. [ ] After approval: update Landing CTA from `/docs#extension` to the store URL  

**Not automated:** Google account / Developer Dashboard submit — human only.
