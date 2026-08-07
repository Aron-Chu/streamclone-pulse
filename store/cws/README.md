# Chrome Web Store assets (StreamPulse)

Generated Peak mark + listing screenshots for CWS readiness.
**Publishing to CWS still requires operator submit** — this packet is readiness only.
Do not claim the extension is published until Chrome Web Store review completes.

## Icons

| File | Size | Use |
|------|------|-----|
| `source/mark-peak-spike.png` | source | Operator-chosen Peak |
| `../public/icons/icon{16,48,128}.png` | MV3 | Extension manifest + toolbar (`default_icon`) |
| `icons/icon128.png` | **128×128 RGBA PNG** | Store listing icon (transparent outside rounded plate) |
| `icons/small-promo-440x280.png` | 440×280 | Small promo tile |

Regenerate: `npm run icons:cws`

**Icon notes:** CWS and Chrome toolbar need a real alpha channel. Opaque
`Format24bppRgb` 128×128 files (solid square with a painted “round” look) are a
common reject / blank-toolbar failure mode. `icons:cws` asserts PNG color type 6
(RGBA) for square icons.

## Screenshots (exact 1280×800, full bleed, no scrollbars)

Captured from a fresh logged-out **headed Chromium** profile with unpacked
`dist/` on real Twitch pages. Chromium runs off-screen by default so capture
does not steal focus. Set `CWS_VISIBLE=1` only for capture debugging.

| File | Content |
|------|---------|
| `screenshots/01-jynxzi-live-overview.png` | Jynxzi live player + Pulse overview and live metrics |
| `screenshots/02-jynxzi-live-activity.png` | Jynxzi live stream-activity chart and signals |
| `screenshots/03-xqc-offline-chat.png` | xQc offline channel/chat + last-stream recap |
| `screenshots/04-xqc-vod-recap.png` | xQc VOD recap for video `2824179241` |
| `screenshots/05-xqc-vod-reactions.png` | xQc VOD top reaction moments and emotes |

```bash
npm run capture:cws
# optional:
# screenshots only (does not regenerate icons):
# npm run capture:cws:screenshots
# visible debugging:
# CWS_VISIBLE=1 npm run capture:cws:screenshots
```

Defaults: `CWS_LIVE_LOGIN=jynxzi`, `CWS_OFFLINE_LOGIN=xqc`,
`CWS_VOD_ID=2824179241`, and
`CWS_LIVE_BACKEND=https://api.streampulse.stream`. The live capture aborts
without replacing existing screenshots if channel/VOD state no longer matches.

Fixture-based fallback (no live Twitch): `npm run capture:cws:mocked`.

## Paste-ready listing copy

- **Name:** StreamPulse
- **Summary:** Live Pulse overlay for Twitch — viewers, chat, emotes, and games.
- **Single purpose:** Twitch live/VOD Pulse analytics overlay powered by StreamPulse hosted API.
- **Category:** Productivity
- **Language:** English
- **Official URL / Homepage:** https://streampulse.stream/
- **Privacy:** https://streampulse.stream/privacy
- **Support:** https://streampulse.stream/support
- **Host permission justification:** StreamPulse needs access to Twitch pages to display its live/VOD analytics overlay and identify the current channel or video. It connects to the StreamPulse API for sanitized Pulse analytics and coverage data. Optional local development may use a StreamPulse backend on localhost:8081. Emote image assets are loaded by the browser from emote CDNs; the extension does not declare separate CDN host permissions.
- **Remote code:** No. All executable JavaScript is packaged with the extension; no remote JavaScript or WebAssembly is downloaded or evaluated.
- **Scripting justification:** The extension uses bundled scripts to inspect the current Twitch page and resolve live/VOD metadata needed to display the Pulse overlay.
- **Storage justification:** The extension stores user-selected overlay settings, theme preferences, watchlist settings, short-lived caches, and optional local debug logs.
- **Authentication information:** No (public-first build; no Twitch OAuth and no StreamPulse beta/access key).
- **Website content disclosed:** Active Twitch URL and stream/VOD metadata required for the overlay. Do **not** claim raw chat, personal communications, location, financial, health, or authentication information collection.

The current extension is public-first and does not require or send a beta/access key.

**Do not enter Privacy/Support URLs in the CWS form until those routes are deployed and verified publicly.**

The Chrome Web Store **Official URL** selector remains `None` until the
`streampulse.stream` Search Console property is verified for the publisher
account. The Homepage and Support URL fields can still use the direct URLs
above after the new routes are deployed and checked publicly.

## Manifest permissions (audited)

| Permission / host | Why retained |
|-------------------|--------------|
| `storage` | Settings, watchlist, short-lived caches, optional debug logs |
| `scripting` | MAIN-world page inspection for live/VOD metadata |
| `http://localhost:8081/*`, `http://127.0.0.1:8081/*` | Documented local StreamPulse BFF opt-in + HTTP emote proxy |
| `https://api.streampulse.stream/*` | Hosted Pulse API |
| `https://*.twitch.tv/*` | Overlay on Twitch + tab query/messaging |

Removed as unused: `tabs`, `gql.twitch.tv`, and emote CDN host permissions (GQL runs in page context; HTTPS emotes load as `<img>`).

## Zip

```bash
npm run build
npm run zip   # streamclone-pulse.zip from dist/
```

Package version must match `manifest.json` `version` (currently `0.1.0`).

Upload ZIP + `store/cws/icons/icon128.png` + `store/cws/screenshots/*.png` in the
Chrome Web Store developer console.

## Account-only blockers (operator)

- Publisher contact email
- Publisher email verification
- Developer data-use certification
- Final CWS submission and review
