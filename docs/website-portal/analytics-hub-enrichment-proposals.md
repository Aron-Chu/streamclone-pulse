# Analytics hub enrichment proposals (StreamElements / BTTV)

Research-only notes for future hub integrations. No implementation in the analytics hub polish batch.

## StreamElements API

Most StreamElements endpoints under `https://api.streamelements.com/kappa/v2` require the **channel owner's OAuth token**. That limits use for a public aggregate hub that tracks arbitrary Twitch logins without per-streamer authorization.

### Public / low-friction options

| Integration | Endpoint / surface | Hub value | Caveats |
|-------------|-------------------|-----------|---------|
| **Song request — Now playing** | `GET /kappa/v2/songrequest/{channelId}/playing` | Show current track/video on live channel cards; unique context Twitch does not expose | Only works when the channel uses SE song requests; needs SE channel id mapping |
| **Global emote cache refresh pattern** | SE chatbot `!emotes reload` / provider lists | Reference for how SE aggregates Twitch + BTTV + FFZ + 7TV | Not a public REST API for third-party hubs |

### Owner-auth only (not for public hub MVP)

- Tips, loyalty points, activity feed, overlay stats — require authenticated `/channels/me` or channel-scoped tokens.
- Not suitable for enriching arbitrary tracked channels on `streampulse.stream`.

## BTTV public API (StreamElements owns BTTV)

BTTV exposes a **public** REST API at `https://api.betterttv.net/3/` (no auth for read-only trending/global data).

| Integration | Example | Hub value |
|-------------|---------|-----------|
| **Global trending emotes** | BTTV trending / shared emote endpoints | Enrich emote economy panel; helps fill BTTV provider gap in charts when live rollups lack per-provider breakdown |
| **Channel emote sets** | `GET /3/cached/users/twitch/{login}` | Optional per-channel BTTV set size on directory rows |

### Recommended rollout order

1. **BTTV global trending** — broad value, no per-channel auth, complements live IRC emote counts.
2. **SE Now playing** — fun per-channel enrichment; validate only on channels known to use SE song requests.
3. Defer owner-auth SE features unless StreamPulse adds streamer-linked OAuth.

## Related backend gap

Live minute rollups currently persist `total_emote_count` + `seventv_emote_count` but not per-provider counts from `emotes_json`. Fixing that in Streamclone (`internal/analytics`) is the proper fix for Twitch/BTTV/FFZ chart lines; BTTV trending is a complementary enrichment layer, not a substitute.
