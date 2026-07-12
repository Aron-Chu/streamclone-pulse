# StreamPulse Analytics Hub — Product design

| | |
|---|---|
| **Status** | v1 — intent locked (2026-06-26) |
| **Owner** | Aron-Chu |
| **Surfaces** | `streampulse.stream/analytics/*` |
| **Full analytics UI** | `@streamclone/analytics-console` (Streamclone `Analytics.tsx` parity) |

## Product intent (corrected)

The hub is **not** a separate analytics product. It is the **entry door** to Streamclone analytics on the web:

```text
Hub (/analytics)
  → search or pick a channel
  → /analytics/{channelLogin} or /analytics/{channelLogin}/{streamId}
  → full Streamclone AnalyticsConsole (charts, sync rail, emotes, backfill)
```

Watchlist panels, live-now tables, and recent sessions are **shortcuts**, not the destination. The destination is always the Streamclone console for the chosen channel or stream.

Analytics is a **public, no-login surface**. There is no account login, beta-key login, or dashboard auth on any `/analytics/*` route; the legacy `/login` screen is removed and redirects to `/analytics`. `{channelLogin}` is a Twitch channel login (the streamer), not a site account. The public chart hides game/category segment overlays (`AnalyticsConsole showGameSegments={false}`); the backend game endpoints stay intact for Streamclone internal use.

## Information architecture

| Route | Role | UI |
|-------|------|-----|
| `/analytics` | **Hub home** — search + shortcuts | Channel search (primary), stats band, live/recent panels |
| `/analytics/{channelLogin}` | **Channel analytics** | `AnalyticsConsole` — live overview, stream picker, full chart rail |
| `/analytics/{channelLogin}/{streamId}` | **Session analytics** (canonical) | `AnalyticsConsole` — historical stream, same layout as Streamclone |
| `/analytics/{channelLogin}/s/{streamId}` | Backcompat alias | Redirects to `/analytics/{channelLogin}/{streamId}` |
| `/analytics/{channelLogin}?figma=1` | Design-review opt-in | Figma session dashboard (not the default surface) |
| `/analytics/streams` | Streams directory (public placeholder) | Browsable index — coming soon; not auth-gated |

## Primary flow — channel search

1. User lands on `/analytics` (no login required).
2. **Channel search** (prominent, top of hub): type a Twitch channel login → Go.
3. Navigate to `/analytics/{channelLogin}` — no login or watchlist add required.
4. `AnalyticsConsole` loads: resolves channel via `/v1/channels/{channelLogin}`, stream history, minute charts.
5. User picks a stream in the console sidebar → `/analytics/{channelLogin}/{streamId}`.

Secondary flows (unchanged):

- Click a row in Live now / Recent sessions → same console routes via `buildAnalyticsHref` (canonical `/analytics/{channelLogin}/{streamId}`).

## What the hub home is vs is not

| Hub home | Channel / stream routes |
|----------|-------------------------|
| Search + navigation | Full Streamclone analytics |
| Layer 1 pulse summaries | Layer 2 minutes, heatmap, sync, emotes |
| Optional watchlist context | Same console as desktop Streamclone |

## Visual hierarchy (hub home)

> **Command center (2026-06):** The landing is a wide sidebar + grid layout. Section order, allowed KPIs, and dedup rules live in [`analytics-command-center-layout.md`](../website-portal/analytics-command-center-layout.md). Pulse Moments is the hero row; network activity follows; coverage is a compact trust strip.

The hub still **discovers** channels; channel routes still open the full **`AnalyticsConsole`** (same as Streamclone). Command-center layout does not replace console analytics on `/analytics/{login}`.

Legacy sketch (superseded for section order):

```text
┌─────────────────────────────────────────────────────────────┐
│ Analytics                                    [Manage watchlist]│
│ Find any channel — opens full Streamclone analytics below.  │
├─────────────────────────────────────────────────────────────┤
│ [ Search Twitch login…………………………… ] [ Open analytics ]       │  ← PRIMARY
├─────────────────────────────────────────────────────────────┤
│ Global stats band (public / hosted summary)                 │
├──────────────────────┬──────────────────────────────────────┤
│ Your channels        │ Live now (links → console)           │
├──────────────────────┴──────────────────────────────────────┤
│ Recent sessions · Saved moments teaser                      │
└─────────────────────────────────────────────────────────────┘
```

Tokens: same as [`website-portal/design.md`](../website-portal/design.md) §5.5 (`--bg-base`, violet primary, heat ramp for intensity only).

## Figma

Extension frames live under [`pulse-extension/figma/`](../pulse-extension/figma/) — **extension overlay only**.

Portal hub + console parity:

- **Reference implementation:** Streamclone `frontend/src/components/Analytics.tsx` and packaged `@streamclone/analytics-console`.
- **Figma (optional follow-up):** Create a board "StreamPulse Analytics Hub" with two frames: (1) Hub search home, (2) Console embedded in portal chrome — export to `docs/design/figma/hub-home.png` when ready.

## Deploy checklist (P4)

Production `streampulse.stream` must ship:

1. `@streamclone/analytics-console` wired on the channel and session routes.
2. Hub channel search on the `/analytics` landing.
3. `VITE_BACKEND_URL=https://api.streampulse.stream` at build time.
4. No login required for analytics (public, read-only). Beta key remains only for the separate extension/dashboard write flows.

Preview build: `VITE_BACKEND_URL=https://api.streampulse.stream npx vite build` + Pages deploy.

## Related docs

- [`analytics-hub-next-plan.md`](./analytics-hub-next-plan.md) — **what’s remaining next** (deploy checklist, phases)
- [`website-portal-requirements.md`](../pulse-extension/website-portal-requirements.md)
- [`website-portal/design.md`](../website-portal/design.md)
- [`website-portal/tasks.md`](../website-portal/tasks.md) §12 Analytics Hub
