# Public analytics posture (2026-07)

Launch decision for StreamPulse public `/analytics` and related surfaces. This doc is product/policy truth — code enforcement follows in separate tasks where needed.

## Decision summary

| Surface | Posture |
|---------|---------|
| **`/analytics` hub** | Fully public, no-login. Hosted corpus aggregates, live roster, and sanitized moments. |
| **`/analytics/{login}` channel console** | Fully public minute-level **aggregates** (viewer/chat/emote rollups, peaks, recap). Not owner-specific. |
| **Raw chat / user messages** | **Never public.** Backend BFF strips before portal/extension clients. |
| **User-level chatter identity** | **Never public.** |
| **Private clip artifacts / ReplayForge queue** | **Private beta only** (`/dashboard/clips` behind beta key). |
| **Saved moments / bookmarks** | **Private beta only** until a real guest/device principal ships. Public console is read-only. |
| **Extension overlay** | Public with hosted API default; local stack explicit opt-in for developers. |

## Minute-level analytics for non-owner viewers

**Chosen posture:** Public minute-level rollups and emote aggregates for channels in the hosted corpus, with backend sanitization and capacity limits — **not** delayed/coarsened by default for launch.

Rationale:

- Product promise is honest live chat **intelligence** (velocity, emote spikes, peaks) — not raw chat replay.
- Data is already aggregated at minute granularity; portal never exposes message text.
- IRC collection is capacity-governed on the hosted pool (top-N live admission), not unbounded scraping of all Twitch.

**Not claimed:**

- Twitch endorsement or official partnership.
- Streamer ownership of the page (“your analytics”) unless the viewer is the channel owner on a future verified surface.
- Complete corpus coverage of every Twitch channel.

## Rate limits, robots, and discovery

| Control | Launch stance |
|---------|----------------|
| **Rate limiting** | Hosted API capacity governor + CDN; no separate public portal throttle yet. |
| **robots / noindex** | Public hub/channel pages indexable for discovery; `/dashboard/*` and `/admin/*` gated. Revisit if SEO abuse appears. |
| **Owner/private views** | Deferred — no OAuth in this launch slice. |

## Data never public

- Raw IRC / VOD chat messages
- Per-user chatter names or message content in portal/extension payloads
- Private clip render paths before `playback_ready` verification
- Operator sync/repair controls on public console
- Grafana / admin health internals

## Copy guardrails

Landing and hub copy must:

- Say “Open Analytics” / “hosted analytics console” — not “Sign in” or “Connect with beta key” for public paths.
- Avoid “your stats” on `/analytics/{login}` unless owner verification exists.
- Label extension install as beta where Chrome Web Store review is pending; portal `/analytics` is not beta-gated.

## Follow-up code tasks (not in this doc-only pass)

- [ ] Optional `robots.txt` / meta noindex for `/dashboard` if linked accidentally.
- [ ] Owner-verified channel view (future) — separate from public aggregate console.
- [ ] Guest/device bookmark principal if product revives save-on-public-console.

## References

- [`docs/website-portal/design.md`](design.md) — BFF sanitization, no raw chat
- [`docs/pulse-extension/website-portal-requirements.md`](../pulse-extension/website-portal-requirements.md)
- Trust audit: P2-021 in streamclone `issues.md`
