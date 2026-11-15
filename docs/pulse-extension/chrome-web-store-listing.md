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

## Next store candidate: 0.2.7 listing fields

The summary and description below match the approved
[`store/cws/listing-0.2.7.md`](../../store/cws/listing-0.2.7.md), including its
coverage limit, free features and no pricing paragraph.

Updated 2026-11-15 for extension **0.2.7** with Sign in with Twitch compiled
**off** and Supporter sales **not open**. Every claim below matches that
build. See
[`chrome-web-store-review-checklist.md`](./chrome-web-store-review-checklist.md) §B.

### Item name
```
StreamPulse: Twitch Chat Stats & Top Moments
```

### Summary (≤132 characters)
```
Twitch chat stats and 7TV emote trends: a live Pulse chart of chat activity, Top Moments you can jump to, and stream recaps.
```

### Detailed description
```
Twitch chat stats, right beside chat. StreamPulse adds a Pulse panel that charts chat and emote activity (7TV emotes included) minute by minute, so you can see the moments a stream's audience actually reacted to, and jump straight to them in the stream or VOD.

Live charts cover Twitch's busiest channels; other channels show past data or nothing.

What you get:
• Live Pulse chart: chat, emote and viewer activity for the whole stream, with a readout for any minute you point at.
• Top Moments: the strongest reactions, ranked. Pick one to see its card and jump to that point in the stream or VOD.
• Moment pictures: each Top Moment shows what was on screen, even for moments you missed, when Twitch has a VOD of the stream. Pictures are never uploaded, and you can turn them off in settings.
• Stream Recap for past streams: the stream's summary, its Pulse chart and its Top Moments, like on live. Works for streams StreamPulse tracked.
• Bookmarks that stay in your browser and keep the moment's picture.
• One click to the full public analytics for the channel on streampulse.stream.
• Honest coverage: when StreamPulse wasn't tracking part of a stream, the chart says so instead of guessing.
• Free, with no account needed.

Privacy: the extension sends the channel, stream or VOD you're viewing to the StreamPulse API to fetch aggregate activity. It never sends chat messages, your Twitch password or your cookies. Moment pictures come from your Twitch tab and from Twitch's own VOD; StreamPulse never receives them. Full details: https://streampulse.stream/privacy

Help: https://streampulse.stream/support · Feedback: https://streampulse.stream/feedback · Release notes: https://streampulse.stream/changelog
```

The description lists the free features and makes no pricing or Supporter
sales promise. The Account & Supporter screen still says sales are not open.

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
| Marquee promo tile (from 0.2.7) | `store/cws/icons/marquee-1400x560.png` | 1400×560 |

From 0.2.7 the five screenshots are captured on real twitch.tv: the 0.2.7
`dist/` on xQc's live stream (chart hover, a picked minute, Top Moments, an
opened moment) and on one of his past broadcasts (Jump in VOD), in Twitch's
dark theme and theatre view, with nothing drawn on top. They show a real
streamer and his viewers' names as captured, by the owner's pick of
2026-11-15; `store/cws/README.md` has the frame list and the same-day swap to
the fixture set from
`tests/e2e/specs/cws-extension-screenshots.mocked.spec.ts`. The 0.2.6 set
came from that mocked fixture.

---

## Permission justifications (0.2.7 store package)

The store manifests (`manifests/cws.json`, and the same lists in `edge.json`
and `firefox.json`) request `storage`, `scripting` and two hosts:
`https://api.streampulse.stream/*` and `https://*.twitch.tv/*`. Earlier store
manifests in this repo also asked for five image CDNs (7TV, BetterTTV,
FrankerFaceZ, Twitch's static CDN and `cdn.streampulse.stream`); 0.2.2 drops
them, because the panel shows emote, avatar and game images as ordinary
images, which need no host permission, and a store build never fetches image
bytes. Dropping hosts lowers privilege, so existing installs update without a
new permission prompt. Before upload, compare with the published 0.2.1 in the
dashboard Package tab: this repo has no verified record of that package
(`store/cws/README.md`). Paste only these.

### storage
```
Stores StreamPulse settings (theme, panel placement, chart preferences) in chrome.storage.sync, which the browser may sync between devices; short-lived chart and coverage caches in chrome.storage.session; and bookmarks, notes, optional watched history and saved moment pictures in this browser (up to 300 pictures or 8 MB). Extension-only IndexedDB also keeps private account/access credentials, an installation key, connection state, a pending appearance choice and payment or recovery progress. If you press Become a Supporter, the install key identifies this browser to the StreamPulse API. Bookmarks, history and pictures stay here unless you link an invited-tester StreamPulse account; a linked account can save bookmarks and history to that account. Twitch page scripts cannot read the extension-only credentials.
```

### scripting
```
Only on Twitch tabs, using code packaged in the extension:
1. VOD id: a function reads stream and VOD ids from the page; if missing, it asks gql.twitch.tv for the archive id without cookies.
2. VOD pictures: a function reads Twitch preview pictures or a few seconds of low-resolution VOD video (gql.twitch.tv, usher.ttvnw.net, video servers), without cookies.
3. Packaged files injected only when needed:
- content/supporter-card.js: Supporter card preview.
- content/moment-frames.js: small player stills while Moment pictures is on, kept in tab memory; saved moments keep one picture in this browser. Nothing is uploaded.
- content/catch-me-up.js: the top of a stream recap.
4. Popup: reads the channel avatar Twitch shows and checks whether the panel is showing.
The Pulse panel is the declared content script and does not need this permission.
```

### Host permissions (one field)
```
https://*.twitch.tv/*: runs the bundled content script on Twitch channel and VOD pages to show the Pulse panel and identify the channel, stream or VOD being watched; lets the packaged scripts described under scripting run there, including the cookie-free VOD picture reads; and lets the toolbar popup see which Twitch page the active tab shows. A packaged function may also ask gql.twitch.tv for the live stream's archive VOD id, without cookies.
https://api.streampulse.stream/*: fetches aggregate chat and emote activity, Top Moments and coverage for that channel, stream or VOD. If you press Become a Supporter, it registers this install's random key with the API and reads its membership and payment state using private access credentials. If you link an invited-tester StreamPulse account, it also saves your bookmarks, and your watched history if you turn on sync, to that account.
Emote, avatar and game images need no host permission. No remote code is loaded from either host.
```

### Remote code
```
No. All JavaScript is packaged with the extension. No remote JavaScript or WebAssembly is downloaded or evaluated.
```

---

## Privacy practices (dashboard) for 0.2.7

| Data category | 0.2.7 answer | What the extension actually does |
|---------------|--------------|----------------------------------|
| Website content | **Yes** | Sends the channel, stream or VOD identifiers of the Twitch page you open to the StreamPulse API to fetch aggregate activity. |
| Web history | **Yes** (conservative) | That request reveals which Twitch channel, stream or VOD you opened. Watched-moment history stays on the device unless you link a StreamPulse account (invite-only in 0.2.2) and turn on history sync; then it is saved to that account. |
| Authentication information | **Yes** (extension credentials) | The Supporter control keeps a random install key and private access credentials in extension-only storage, and sends them only to `api.streampulse.stream` to read the connection and membership; no passwords are collected. |
| Personally identifiable information | No | No name, email or Twitch identity is collected by the currently offered store flows: Sign in with Twitch is compiled off, and email restore is not offered while Supporter sales are closed. |
| User activity | **Yes** (only with a linked account) | Without an account, bookmarks, notes, watched history and saved pictures stay in the browser. If you link an invited-tester StreamPulse account, bookmarks and watched history can be saved to that account. |
| Financial and payment information | **Yes** (Supporter control only) | The extension reads membership and payment state when connected. Checkout is Stripe-hosted and sales are not open yet; the extension never reads card details. |
| Personal communications, health, location | No | Chat messages are never read into or sent by the extension. |
| Certifications | All three | Not sold to third parties; not used for unrelated purposes; not used for creditworthiness. Matches the Limited Use statement on `/privacy`. |

The package carries the same disclosures in its Firefox manifest. Supporter
sales remain closed, so no payment form is shown inside the extension.

---

## Next candidate submission checklist (all unchecked)

1. [ ] Packaging commit: set 0.2.7 to `status: "released"` with the real submission date in `src/shared/release-notes.json` (it stays unreleased with no date until then; the site's /changelog shows its notes only once it is released), and confirm the published 0.2.1's date and hosts in the dashboard Package tab
2. [ ] Build store-target package from the release SHA (no localhost hosts)
3. [ ] Run typecheck, unit tests, packaging, and store-target package validation
4. [ ] Recapture and review screenshots from that package `dist/`
5. [ ] Record package commit, size, and SHA-256 for the **new** candidate
6. [ ] Remote CI green on that SHA (jobs actually executed)
7. [ ] Owner uploads new ZIP + screenshots; pastes listing and permission fields
8. [ ] Set privacy URL (`/privacy`), Support URL (`/support`), and Limited Use/data disclosures
9. [ ] Confirm dashboard Support URL matches `https://streampulse.stream/support`
10. [ ] Submit for review only with owner authorization
11. [ ] After approval: update public install CTA only if owner authorizes

**Forbidden:** uploading ZIP SHA `ae8d9b835d8459e4b886fad6948e903d6c0c9bae035119ad018cd42fbb253075`.

**Not automated:** Google account / Developer Dashboard submit — human only.
