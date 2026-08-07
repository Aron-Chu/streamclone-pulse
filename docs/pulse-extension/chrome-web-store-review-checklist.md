# Chrome Web Store / AMO review checklist (StreamPulse)

Extension ships public-first for Twitch live/VOD Pulse analytics. Store listing
submit is operator-owned.

## Pre-submit

- [ ] `npm test` + `npm run typecheck` + `npm run build` + `npm run zip` pass locally
- [x] `host_permissions` includes `https://api.streampulse.stream/*` (manifest.json)
- [x] `cdn.streampulse.stream` — not required today (emotes via browser `<img>` / page context)
- [x] No secrets, beta keys, or access keys in extension bundle or options UI
- [x] Content scripts use `chrome.runtime.sendMessage` — no direct `fetch` from content scripts
- [x] Public privacy-policy route implemented at `/privacy` (deploy + verify before CWS URL entry)
- [x] Public support route implemented at `/support` (deploy + verify before CWS URL entry)
- [ ] Deploy and verify both routes publicly before entering them in the CWS listing
- [x] Screenshots: **real extension on live twitch.tv** under `store/cws/screenshots/` — 1280×800 via `npm run capture:cws`
- [x] Single purpose: Twitch live/VOD Pulse analytics overlay powered by StreamPulse hosted API
- [x] Peak store icon + small promo tile — `npm run icons:cws` (128×128 **RGBA** PNG; see `store/cws/README.md`)

## Chrome Web Store (paste-ready)

- **Single purpose:** Twitch live/VOD Pulse analytics overlay powered by StreamPulse hosted API.
- **Category:** Productivity
- **Language:** English
- **Host permission justification:** StreamPulse needs access to Twitch pages to display its live/VOD analytics overlay and identify the current channel or video. It connects to the StreamPulse API for sanitized Pulse analytics and coverage data. Optional local development may use a StreamPulse backend on localhost:8081.
- **Remote code:** No. All executable JavaScript is packaged with the extension; no remote JavaScript or WebAssembly is downloaded or evaluated.
- **Scripting justification:** The extension uses bundled scripts to inspect the current Twitch page and resolve live/VOD metadata needed to display the Pulse overlay.
- **Storage justification:** The extension stores user-selected overlay settings, theme preferences, watchlist settings, short-lived caches, and optional local debug logs.
- **Authentication information:** No
- **Website content:** Active Twitch URL and stream/VOD metadata for the overlay only. Do not disclose raw chat, personal communications, location, financial information, health information, or authentication information.

## Permissions (audited)

- [x] `permissions`: `storage`, `scripting` only (no `tabs`)
- [x] Hosts: local BFF `:8081`, hosted API, `*.twitch.tv` only
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

## Account-only blockers

- [ ] Publisher contact email
- [ ] Publisher email verification
- [ ] Developer data-use certification
- [ ] Final CWS submission and review

## Post-approval

- [ ] Update `Landing.tsx` CTA from `/docs#extension` to store URL
- [ ] Confirm the public-first extension has no beta-key or access-key setting
