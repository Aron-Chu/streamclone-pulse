# Chrome Web Store listing copy — StreamPulse

**Document roles**

1. **Historical / published** — facts about the live listing ID and prior obsolete package (audit only).
2. **Next RPR candidate** — unchecked gates; paste fields for a future store ZIP that omits localhost.

Do not treat historical ZIP bytes as the current upload candidate.

---

## Historical / published (verify in dashboard)

| Field | Value |
|-------|--------|
| Listing URL | https://chromewebstore.google.com/detail/streampulse/nifgoonpcgmdhiffcpmhndjgkgahnelg |
| Extension ID | `nifgoonpcgmdhiffcpmhndjgkgahnelg` |
| Privacy policy | https://streampulse.stream/privacy |
| Support URL (site) | https://streampulse.stream/support |
| Privacy contact | privacy@streampulse.stream |
| Manifest name | StreamPulse |
| Dashboard Support URL | **Owner confirmation required** — public scrape is not authoritative |

### Obsolete package (do not upload)

| Field | Value |
|-------|--------|
| Prior `PACKAGE_BUILD_COMMIT` | `ada58beb620a0955030528f46a5bc66e3c3010cb` |
| ZIP SHA-256 | `ae8d9b835d8459e4b886fad6948e903d6c0c9bae035119ad018cd42fbb253075` (205,205 bytes) |
| Status | Historical audit only — **obsolete for upload** after privacy/support/manifest program changes |

Do **not** use “Streamclone Pulse” in store-facing fields.

---

## Next RPR candidate — store listing fields

All submission gates for the next candidate start unchecked. See
[`chrome-web-store-review-checklist.md`](./chrome-web-store-review-checklist.md) §B.

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
• Settings for theme, placement, chart preferences, and an optional Protect watchlist
• Works with Twitch channel and VOD pages

How it works
The extension reads the Twitch page context to identify the channel / stream / VOD, then the service worker calls the StreamPulse API (https://api.streampulse.stream) for minute-level aggregates. Raw chat is not shown in the overlay. Scoring and rollups come from the backend — the extension does not invent Pulse scores client-side.

Protect is optional. A beta access key is used once to enroll this browser as a device; the key is discarded
and an opaque device token is stored only in local trusted extension storage. The token is not synced between
browsers. A channel saved without enrollment is a browser-local preference, not a server-protected channel.
The extension shows pending, protected, unauthorized, cap, retry, and failure states rather than claiming
protection after a rejected write. Removing a channel keeps a local tombstone until the server confirms deletion.

Privacy
See https://streampulse.stream/privacy — including Chrome Web Store Limited Use language and contact privacy@streampulse.stream.

Access
The overlay can be read without Twitch OAuth. Optional hosted Protect enrollment requires a one-time beta
access key; after enrollment, protected watchlist requests use the local device token. The token can be
rotated or revoked from Options.

Support
Support page: https://streampulse.stream/support
Contact: privacy@streampulse.stream (current verified contact)
Product docs: https://streampulse.stream/docs#extension
```

### Category
`Productivity` (or `Social & Communication` if Dashboard forces a closer match — prefer Productivity)

### Language
English (United States)

---

## Graphic assets

| Asset | Path | Size |
|-------|------|------|
| Screenshots (required) | Approved mocked RC set only: `store/cws/screenshots/` | 1280×800 |
| Store icons | packaged from `public/icons/icon{16,48,128}.png` | Peak mark |

Recapture screenshots from the **next candidate** `dist/` only. Do not reuse obsolete-package capture commits as proof for a new ZIP.

---

## Permission justifications — next **store** artifact only

Paste only for permissions present in the store ZIP. **Do not** paste localhost optional-host justifications for the store submission.

### storage
```
Stores StreamPulse settings (theme, overlay placement, chart preferences, browser-saved watchlist) in chrome.storage.sync; short-lived Pulse/coverage cache in chrome.storage.session; and the optional Protect device token plus server-confirmation metadata/tombstones in chrome.storage.local so credentials are not synced between browsers. Optional debug logs may use chrome.storage.local when debug logging is enabled.
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

### Host permission — https://*.twitch.tv/*
```
Runs the content script on Twitch channel and VOD pages and allows chrome.scripting injection / tab messaging under the Twitch host grant (no broad tabs permission). The wildcard covers Twitch subdomains used by the product (including gql.twitch.tv for extension-origin network access if ever used). StreamPulse does not declare a separate https://gql.twitch.tv/* host permission: GraphQL stream/VOD discovery runs in the Twitch page MAIN world using the page network context.
```

### Localhost (development manifests only — not for store paste)

Local StreamPulse BFF hosts (`http://localhost:8081/*`, `http://127.0.0.1:8081/*`) belong only in a **development** manifest after RPR-2 splitting. They must be absent from the store artifact. Do not paste a store justification for them.

---

## Data safety / disclosure checklist (Dashboard)

| Question | Answer |
|----------|--------|
| Collects user data? | Yes — limited: channel/stream/VOD identifiers sent to StreamPulse API; optional Protect device credential and watchlist state; settings in Chrome storage |
| Sold to third parties? | No |
| Used for ads / unrelated profiling? | No |
| Remote hosted code? | **No** — bundled JS only |
| Privacy policy URL | https://streampulse.stream/privacy |
| Support URL | https://streampulse.stream/support |
| Limited Use | Affirmed on privacy page + this listing |
| Extension crash/product analytics SDKs | Not present in the current extension package |
| Protect enrollment | Optional one-time beta key enrollment; key discarded; opaque device token stored locally and revocable |
| Separate default-off analytics consent | Options toggle exists; ingest kill switch remains off; no PostHog host permission |
| PostHog processing | Server-side aggregates only after activation; no identity; ~180-day retention target (not claiming activation) |

---

## Single purpose

```
Provide a Twitch live/VOD Pulse analytics overlay powered by the StreamPulse API.
```

---

## Next candidate submission checklist (all unchecked)

1. [ ] Build store-target package from the release SHA (no localhost hosts)
2. [ ] Run typecheck, unit tests, packaging, and store-target package validation
3. [ ] Recapture and review screenshots from that package `dist/`
4. [ ] Record package commit, size, and SHA-256 for the **new** candidate
5. [ ] Remote CI green on that SHA (jobs actually executed)
6. [ ] Owner uploads new ZIP + screenshots; pastes listing and permission fields
7. [ ] Set privacy URL (`/privacy`), Support URL (`/support`), and Limited Use/data disclosures
8. [ ] Confirm dashboard Support URL matches `https://streampulse.stream/support`
9. [ ] Submit for review only with owner authorization
10. [ ] After approval: update public install CTA only if owner authorizes

**Forbidden:** uploading ZIP SHA `ae8d9b835d8459e4b886fad6948e903d6c0c9bae035119ad018cd42fbb253075`.

**Not automated:** Google account / Developer Dashboard submit — human only.
