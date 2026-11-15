# Chrome Web Store listing draft — 0.2.7

Paste these fields in the dashboard with the 0.2.7 upload. Every claim matches
the 0.2.7 build: Supporter sales are not open, and nothing needs an account.
The other fields (name, category, language, single purpose, URLs, permission
justifications and privacy practices) stay as in
[`docs/pulse-extension/chrome-web-store-listing.md`](../../docs/pulse-extension/chrome-web-store-listing.md).

What changed from 0.2.6:

- The summary carries the words people search for ("stats", "7TV").
- The description ends without the pricing paragraph, which read as "paid
  later". Its list is now headed "What you get" and ends with "Free, with no
  account needed". The settings bullet (feedback, Discord, release notes) is
  gone: it is not something you get, and the Help line links feedback and the
  release notes.
- Two promo tiles carry the new summary (see the table below).

### Summary (≤132 characters)

The store reads it from `manifest.json` `description`, so it goes out with the
0.2.7 package; the dashboard field shows the same line.

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

### Promo tiles

Rendered by `npm run icons:cws` (`scripts/gen-cws-icons.mjs`) from the Peak
mark and the manifest summary, so a new summary means a re-render.

| Tile | Path | Size | Text |
|------|------|------|------|
| Small promo tile | `store/cws/icons/small-promo-440x280.png` | 440×280 | StreamPulse + the summary's lead, "Twitch chat stats and 7TV emote trends" (the whole line is unreadable at search-result size) |
| Marquee promo tile | `store/cws/icons/marquee-1400x560.png` | 1400×560 | StreamPulse + the whole summary |

A promo video can come later.
