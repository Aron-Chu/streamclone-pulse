# Chrome Web Store listing copy — StreamPulse

**Status:** Candidate locked - pending PR checks and operator upload
**Branch:** `codex/cws-live-screenshots-2026-07-19`
**`PACKAGE_BUILD_COMMIT`:** `f290b0d82d7c1331560cce08f9b0bf5b42b650b1`
**Package:** `streampulse-extension.zip` (built once from `PACKAGE_BUILD_COMMIT`; do not regenerate after hash lock)
**ZIP SHA-256:** `ad0154571b6aa07267fb8b18561d0f835c5e0686bf4e9d44fcd7d12366a23eb1` (205,205 bytes)
**Privacy policy:** https://streampulse.stream/privacy
**Support URL:** https://streampulse.stream/support
**Privacy contact:** privacy@streampulse.stream  
**Manifest name:** StreamPulse  
**Version (current package):** 0.1.0  
**Portal install mode until Google approval:** `pending_verification` (no Landing store-URL flip)

This replacement candidate uses the required HTTPS-only Twitch content-script
match. Typecheck, 512 unit tests, 29 headed mocked extension tests, packaging,
and current package validation passed before the ZIP hash was locked. The five
screenshots were then recaptured from the unchanged packaging `dist/`.

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
Support page: https://streampulse.stream/support
Privacy & support email: privacy@streampulse.stream
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

Recapture only from a clean checkout and `dist/` built at `PACKAGE_BUILD_COMMIT`
(retired: `scripts/gen-cws-screenshots.ps1`). The capture script fails instead
of rebuilding when its inputs, complete `dist/` file set, provenance hashes, or
build commit do not match the locked package source:
```bash
node scripts/capture-cws-pulse-screenshot.mjs --package-build-commit=f290b0d82d7c1331560cce08f9b0bf5b42b650b1 --shot=all
```

Suggested upload order:
1. `01-live-pulse-panel-1280x800.png` — live Pulse panel
2. `02-stream-activity-chart-1280x800.png` — stream activity chart
3. `03-pulse-duo-1280x800.png` — Pulse duo
4. `04-moments-and-chart-1280x800.png` — moments + chart
5. `05-stream-recap-1280x800.png` — Stream Recap

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
| Support URL | https://streampulse.stream/support |
| Limited Use | Affirmed on privacy page + this listing |

---

## Single purpose

```
Provide a Twitch live/VOD Pulse analytics overlay powered by the StreamPulse API.
```

---

## Submission checklist (operator)

1. [x] Build the replacement candidate with the HTTPS-only Twitch content-script match
2. [x] Run typecheck, 512 unit tests, 29 headed mocked E2E tests, packaging, and current package validation
3. [x] Recapture and review all five screenshots from the unchanged packaging `dist/`
4. [x] Lock `PACKAGE_BUILD_COMMIT`, exact ZIP bytes, size, and SHA-256 in both handoff documents
5. [ ] Merge the traceability PR only after required CI and review checks actually run and pass
6. [ ] Upload the locked ZIP and matching screenshots, then paste listing and permission fields
7. [ ] Set privacy URL (`/privacy`), Support URL (`/support`), and Limited Use/data disclosures
8. [ ] Submit for review
9. [ ] After approval: update the public install CTA to the store URL and clear `pending_verification`

**Not automated:** Google account / Developer Dashboard submit — human only.
