# Pulse Moments Live — layout options

Visual mockups only. Placeholder copy in mockups is **not** wired to `/analytics`.

## Implemented direction

**Variant A** — Global activity chart first, Pulse Moments Live below, inspector on the right, 7TV emote pulse bar in the moments header.

## Mockup files

- Static HTML: [`streampulse-web/src/ui/components/analytics/__mockups__/moments-live-options.html`](../../streampulse-web/src/ui/components/analytics/__mockups__/moments-live-options.html)

## Variants

| Variant | Layout | Notes |
|---------|--------|-------|
| **A** | Chart → emote bar → moments list + inspector | Shipped on `/analytics` |
| **B** | Chart → mini selected-moment strip → full list | Good when inspector feels too tall |
| **C** | Dense terminal table + emote bar + drawer inspector | Mobile / power-user option |

## Data rules (production)

- Moment rows from `featuredSession.topMoments` only
- Emote images when `imageUrl` exists (hub `topEmotes` lookup fallback)
- VOD pills: Synced / Partial / Live IRC — no invented states
