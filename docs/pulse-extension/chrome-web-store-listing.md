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
| Terms of use | https://streampulse.stream/terms |
| Cancellation & refunds | https://streampulse.stream/refunds |
| Supporter offer | https://streampulse.stream/supporter |
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

## Next store candidate: 0.2.2 listing fields

Written 2026-10-09 for extension **0.2.2** with Sign in with Twitch compiled
**off** and Supporter sign-ups **not open**. Every claim below matches that
build; re-check it before pasting for any later version. All submission gates
start unchecked. See
[`chrome-web-store-review-checklist.md`](./chrome-web-store-review-checklist.md) §B.

### Item name
```
StreamPulse
```

### Summary (≤132 characters)
```
See what Twitch chat reacted to: a live Pulse chart of chat and emote activity, Top Moments you can jump to, and stream recaps.
```

### Detailed description
```
StreamPulse adds a Pulse panel beside Twitch chat. It charts chat and emote activity minute by minute, so you can see the moments a stream's audience actually reacted to, and jump straight to them.

• Live Pulse chart: chat, emote and viewer activity for the whole stream, with a readout for any minute you point at.
• Top Moments: the strongest reactions, ranked. Pick one to see its card and jump to that point in the stream or VOD.
• Recaps for offline channels and VODs.
• Bookmarks that stay in your browser: no account needed.
• One click to the full public analytics for the channel on streampulse.stream.
• Honest coverage: when StreamPulse wasn't tracking part of a stream, the chart says so instead of guessing.
• Help & Feedback in settings: send private feedback, join the Discord, read the release notes.

Privacy: the extension sends the channel, stream or VOD you're viewing to the StreamPulse API to fetch aggregate activity. It never sends chat messages, your Twitch password or your cookies. Full details: https://streampulse.stream/privacy

Free: every analytics feature is free. An optional Pulse Supporter membership (US$4.99/month, once sign-ups open; they are not open yet) adds cosmetics only you see in your own extension: title paint, a tenure crest, emote rain (the 7TV header backdrop) and a Supporter card.

Help: https://streampulse.stream/support · Feedback: https://streampulse.stream/feedback · Release notes: https://streampulse.stream/changelog
```

The Supporter sentence names the same four perks, in the same order, as
`src/shared/supporter-perks.json`, which the extension and the website's
/supporter page and Terms render.

### Category
`Entertainment` (the live listing's category; keep it).

### Language
English (United States)

### Single purpose
```
Show Twitch chat and emote activity for the stream or VOD you are watching, in a panel beside Twitch chat.
```

### URLs
| Field | Value |
|-------|-------|
| Support URL | `https://streampulse.stream/support` |
| Homepage | `https://streampulse.stream/` |
| Privacy policy | `https://streampulse.stream/privacy` |

---

## Graphic assets

| Asset | Path | Size |
|-------|------|------|
| Screenshots (required) | `store/cws/screenshots/` (see `manifest.json` there) | 1280×800 |
| Store icon | `store/cws/icons/icon128.png` | 128×128 RGBA |
| Small promo tile | `store/cws/icons/small-promo-440x280.png` | 440×280 |

The 0.2.2 screenshots were regenerated on 2026-10-09 from the extension RC
build on the mocked Twitch fixture (synthetic channel, no real streamer or
email), by `tests/e2e/specs/cws-extension-screenshots.mocked.spec.ts`. Mocked
captures are not live evidence.

---

## Permission justifications (0.2.2 store package)

The store manifest (`manifests/cws.json`) requests `storage`, `scripting` and
the seven hosts below, the same set as the 0.2.1 package. Paste only these.

### storage
```
Stores your StreamPulse settings (theme, panel placement, chart preferences) in chrome.storage.sync; short-lived chart and coverage caches in chrome.storage.session; and, on this device only, your bookmarks, notes and optional watched-moment history in extension storage. Nothing in local storage is synced or uploaded.
```

### scripting
```
Injects the bundled StreamPulse script on Twitch pages so the Pulse panel can sit beside chat and read the page details needed to identify the current channel, live stream or VOD.
```

### Host permissions (one field)
```
https://*.twitch.tv/*: runs the bundled content script on Twitch channel and VOD pages to show the Pulse panel and identify the channel, stream or VOD being watched.
https://api.streampulse.stream/*: fetches aggregate chat and emote activity, Top Moments and coverage for that channel, stream or VOD from the StreamPulse API.
https://cdn.7tv.app/*, https://cdn.betterttv.net/*, https://cdn.frankerfacez.com/*, https://static-cdn.jtvnw.net/*: loads the 7TV, BetterTTV, FrankerFaceZ and Twitch emote images the panel shows.
https://cdn.streampulse.stream/*: loads StreamPulse-hosted images shown in the panel.
No remote code is loaded from any of these hosts.
```

### Remote code
```
No. All JavaScript is packaged with the extension. No remote JavaScript or WebAssembly is downloaded or evaluated.
```

---

## Privacy practices (dashboard) for 0.2.2

| Data category | 0.2.2 answer | What the extension actually does |
|---------------|--------------|----------------------------------|
| Website content | **Yes** | Sends the channel, stream or VOD identifiers of the Twitch page you open to the StreamPulse API to fetch aggregate activity. |
| Web history | **Yes** (conservative) | That request reveals which Twitch channel, stream or VOD you opened. Watched-moment history stays on the device and is never uploaded in 0.2.2. |
| Authentication information | **Yes** (invited testers only) | Invited testers can connect the extension to a StreamPulse account with a one-time code; an opaque device credential is then kept in extension storage and sent only to `api.streampulse.stream`. No passwords are collected. Everyone else: none. |
| Personally identifiable information | No | No name, email or Twitch identity is collected in this build (Sign in with Twitch is compiled off). |
| User activity | No | Bookmarks, notes and watched history stay on the device. |
| Financial and payment information | No | Supporter checkout happens on Stripe-hosted pages and is not open yet. |
| Personal communications, health, location | No | Chat messages are never read into or sent by the extension. |
| Certifications | All three | Not sold to third parties; not used for unrelated purposes; not used for creditworthiness. Matches the Limited Use statement on `/privacy`. |

When Sign in with Twitch ships (0.2.3 or later), add **Personally identifiable
information** (Twitch user ID, display name and picture) and revisit
**Authentication information** and **User activity** (synced bookmarks and
history) before that upload.

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
