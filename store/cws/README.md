# Chrome Web Store assets (StreamPulse)

Generated Peak mark + listing screenshots for CWS readiness.

October 31 source candidate: **0.2.7**, preparing Supporter recovery and
refund/rejoin handling. Its notes are unreleased with no submission date.
The last recorded public Chrome listing was 0.2.6 on October 29; confirm the
publisher dashboard, Support URL and trader details before a new upload.

Canonical process docs:

- [`docs/pulse-extension/chrome-web-store-review-checklist.md`](../../docs/pulse-extension/chrome-web-store-review-checklist.md)
- [`docs/pulse-extension/chrome-web-store-listing.md`](../../docs/pulse-extension/chrome-web-store-listing.md)
- [`docs/pulse-extension/release.md`](../../docs/pulse-extension/release.md)

---

## Historical / published listing (verify in dashboard)

| Field | Value |
|-------|-------|
| Listing URL | https://chromewebstore.google.com/detail/streampulse/nifgoonpcgmdhiffcpmhndjgkgahnelg |
| Extension ID | `nifgoonpcgmdhiffcpmhndjgkgahnelg` |
| Website install CTAs | Prefer the listing URL above when configured (`streampulse-web` public site config) |
| Privacy | https://streampulse.stream/privacy |
| Support (site) | https://streampulse.stream/support |
| Terms of use | https://streampulse.stream/terms |
| Cancellation & refunds | https://streampulse.stream/refunds |
| Supporter offer | https://streampulse.stream/supporter |

**Owner dashboard gates (open):**

- Confirm the live CWS version in the publisher dashboard. The public listing
  reported `0.1.1` on 2026-09-20 and **`0.2.1`** on 2026-09-24; neither
  observation is dashboard evidence.
- The source revision of the published `0.2.1` is **unverified**: no commit or
  tag in this repository sets 0.2.1, no attested 0.2.x artifact exists, and the
  local `streampulse-extension-cws-0.2.1.zip` (built 2026-09-21 from a dirty
  tree) is not evidence of the published package. See
  [`docs/pulse-extension/release.md`](../../docs/pulse-extension/release.md).
- Change and confirm the CWS **Support URL** field as
  `https://streampulse.stream/support`. The public listing was observed linking
  Support to Twitch on 2026-09-20, but the public scrape is not authoritative
  for the configured dashboard field.
- Before packaging 0.2.7, open the dashboard **Package** tab and record its
  current published version, upload date and requested hosts. `release-notes.json`
  retains earlier released entries; match the actual package to its own evidence.
  Store users never had the 7TV header backdrop as a free perk.
- 0.2.7 stays `status: "unreleased"` with no `releasedAt` until the packaging
  commit, which sets `released` and the real submission date. `package:cws`
  refuses the notes until then, by design. The private feedback form may stay
  off (owner decision D19); see the `FEEDBACK_FORM_LIVE` line in
  [`docs/pulse-extension/release.md`](../../docs/pulse-extension/release.md).
- Do not upload a new package unless separately authorized.
- Existing installs update only after a higher version is uploaded, approved, and rolled out.

### Obsolete package (audit only)

Prior locked ZIP SHA-256 `ae8d9b835d8459e4b886fad6948e903d6c0c9bae035119ad018cd42fbb253075` is **obsolete for upload** after privacy/support/manifest program changes. Do not upload or regenerate it as the current candidate.

---

## Next RPR store candidate (unchecked)

- [x] Store-target package with **no** localhost / `127.0.0.1` hosts
- [x] Development-only local BFF access moved to a separate development manifest (RPR-2 / R18)
- [ ] `package:cws` + `validate:package:cws` green on the release SHA
- [ ] Local + remote CI green on the same SHA
- [ ] Privacy/Support disclosures match current behavior
- [ ] Real unpacked-extension Twitch smoke recorded for the release SHA
- [ ] Publisher-dashboard version and Support URL checks recorded
- [ ] Owner-authorized upload of a **new** version (not the obsolete ZIP)

Existing `package:cws` / `validate:package:cws` work continues and must be extended — do not claim it is absent.
Use `validate:package` only for the **development** (non-uploadable) target.

---

## Icons

| File | Size | Use |
|------|------|-----|
| `source/mark-peak-spike.png` | source | Operator-chosen Peak |
| `../public/icons/icon{16,48,128}.png` | MV3 | Extension manifest + toolbar (`default_icon`) |
| `icons/icon128.png` | **128×128 RGBA PNG** | Store listing icon (transparent outside rounded plate) |
| `icons/small-promo-440x280.png` | 440×280 | Small promo tile (mark, name and the summary's lead) |
| `icons/marquee-1400x560.png` | 1400×560 | Marquee promo tile (mark, name and the whole summary) |

Regenerate: `npm run icons:cws`

**Icon notes:** CWS and Chrome toolbar need a real alpha channel. Opaque
`Format24bppRgb` 128×128 files (solid square with a painted “round” look) are a
common reject / blank-toolbar failure mode. `icons:cws` asserts PNG color type 6
(RGBA) for square icons.

## Screenshots (exact 1280×800 PNG, one headline each)

Store set regenerated 2026-11-13 from the current `dist/` on the mocked Twitch
fixture (see `screenshots/manifest.json`). The browser renders at 1.6× device
scale, so each frame shows one part of the real Pulse panel at 1.6× its
default size, cut at section edges, beside a headline and one sub-line drawn
by the harness (outside the extension). Every frame is synthetic: a made-up
channel (`streampulse_demo`), our own emote art from
`tests/e2e/fixtures/store-emotes`, and no real streamer, face, footage or
account. No Supporter card and no version number appear in any frame.

| File | Headline | Content |
|------|----------|---------|
| `screenshots/01-pulse-chart.png` | Twitch chat stats, live | Live Stream Activity chart (viewers, chat and emotes per minute) with the minute readout on the biggest spike |
| `screenshots/02-top-moments.png` | Jump to the moments chat reacted to | Live Top Moments: five ranked chat and emote spikes |
| `screenshots/03-vod-jump.png` | Watch the moment again on the VOD | Past broadcast: a picked moment's details and Jump button, the moment list, and the "Jumped to … in the VOD player" notice |
| `screenshots/04-stream-recap.png` | A recap of every stream | Past broadcast: Replay header, Stream Recap (length, messages, games, chat peak) and games played |
| `screenshots/05-emotes.png` | See which 7TV and Twitch emotes chat is using | Expanded chart with three emotes plotted, and the Plot on chart picker with each top emote's use count |

Generated by `tests/e2e/specs/cws-extension-screenshots.mocked.spec.ts` against
the built `dist/`. Mocked captures are not live evidence. A live Twitch
re-capture remains a separate, reviewed operator workflow.

```bash
# mocked fixture screenshots (regenerates store/cws/screenshots/ on purpose).
# Headless needs the full Chromium channel: the headless shell loads no extension.
npm run build
PULSE_EXTENSION_HEADLESS=1 PULSE_EXTENSION_BROWSER_CHANNEL=chromium npx playwright test tests/e2e/specs/cws-extension-screenshots.mocked.spec.ts --project=extension-mocked
```

## Paste-ready listing copy (0.2.7)

The 0.2.7 summary, description and promo tiles are in
[`listing-0.2.7.md`](listing-0.2.7.md). Single purpose, permission
justifications and the privacy-practices table carry over from the 0.2.6
fields in
[`docs/pulse-extension/chrome-web-store-listing.md`](../../docs/pulse-extension/chrome-web-store-listing.md).
In short:

- **Name:** StreamPulse: Twitch Chat Stats & Top Moments
- **Summary:** Twitch chat stats and 7TV emote trends: a live Pulse chart of chat activity, Top Moments you can jump to, and stream recaps.
- **Single purpose:** Show Twitch chat and emote activity for the stream or VOD you are watching, in a panel beside Twitch chat.
- **Category:** Entertainment (the live listing's category)
- **Language:** English
- **Homepage:** https://streampulse.stream/
- **Privacy:** https://streampulse.stream/privacy
- **Support URL:** https://streampulse.stream/support
- **Remote code:** No. All executable JavaScript is packaged with the extension.
- **Privacy practices:** Website content yes; Web history yes (conservative); Authentication information yes for invited testers only; everything else no. Reasons per row in the listing doc.

The Chrome Web Store **Official URL** selector may remain `None` until the
`streampulse.stream` Search Console property is verified for the publisher
account. Homepage and Support URL fields can use the direct URLs above.

## Manifest permissions

### Current development `manifest.json` (baseline)

May still include optional localhost hosts for local BFF debugging. That is **not** the next store artifact contract.

### Next store artifact (RPR-2 / R18)

| Permission / host | Why retained |
|-------------------|--------------|
| `storage` | Settings, short-lived caches, and device-only bookmarks, notes and watched history |
| `scripting` | MAIN-world page inspection for live/VOD metadata; on-demand packaged files (`content/supporter-card.js`, `content/moment-frames.js`, `content/catch-me-up.js`); popup avatar and panel-shown reads |
| `https://api.streampulse.stream/*` | Hosted Pulse API |
| `https://*.twitch.tv/*` | Content-script / scripting injection on Twitch hosts (www, m, clips, …), and the popup reading the active Twitch tab's URL. Wildcard also covers `gql.twitch.tv` for extension-origin network access, but GQL discovery runs in page MAIN world without a separate `gql.twitch.tv` host entry. |

Not requested by store builds: the emote and image CDNs (`cdn.7tv.app`,
`cdn.betterttv.net`, `cdn.frankerfacez.com`, `static-cdn.jtvnw.net`,
`cdn.streampulse.stream`). The panel shows those images as plain `<img>`
elements, which need no host permission, and only development builds proxy
local emote images through the worker (`src/background/emoteImageFetch.ts`).
Chrome's install prompt for the store set reads "Read and change your data on
all twitch.tv sites and api.streampulse.stream" instead of "Read and change
your data on a number of websites". The development manifest keeps the CDNs.

**Must exclude from store ZIP:** `http://localhost:8081/*`, `http://127.0.0.1:8081/*`, any other local origins.

Content scripts match `https://*.twitch.tv/*` only. Removed as unused: `tabs`. There is **no** separate `https://gql.twitch.tv/*` host permission entry.

## Zip (next candidate)

```bash
# Atomic store packaging (preferred):
npm run package:cws
# Equivalent stepwise store validation:
npm run validate:package:cws

# Edge:
npm run package:edge
# or:
npm run validate:package:edge

# Development only — NOT uploadable:
npm run package:development
npm run validate:package
```

Extension source manifests are **0.2.6**; the submission date is set only by
the packaging commit. This is a source target, not an
accepted or uploaded candidate: the public
listing already reported `0.2.1` on 2026-09-24, and the published package's
source revision is unverified. Owner must confirm the publisher-dashboard
version, confirm the candidate's scope and version exceed the live listing, and set
the Support URL to `https://streampulse.stream/support` before upload. Stop
before upload.

Do not upload ZIP SHA `ae8d9b835d8459e4b886fad6948e903d6c0c9bae035119ad018cd42fbb253075`.

## Account-only follow-up (operator)

- Confirm the publisher-dashboard version and Support URL; do not substitute a
  public scrape for dashboard evidence.
- Optionally review a live-Twitch screenshot capture before replacing the validated mocked set.
- Record a real unpacked-extension Twitch smoke for the release SHA.
- Upload only with explicit owner authorization after next-candidate gates pass.
