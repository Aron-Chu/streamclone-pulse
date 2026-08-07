# StreamPulse Analytics Figma Parity Requirements

> Decision record and build contract for making `/analytics` a Figma-perfect StreamPulse analytics mockup instead of a hybrid aggregate hub.

| | |
|---|---|
| **Status** | Active implementation contract |
| **Owner** | Aron-Chu |
| **Decision** | `/analytics` SHALL target the Figma Make redesign mockup. |
| **Primary source** | [Figma Make — StreamPulse Analytics Page Redesign](https://www.figma.com/make/C35yDLsXdkoRyDvnlxd5gr/StreamPulse-Analytics-Page-Redesign) (file key `C35yDLsXdkoRyDvnlxd5gr`) |
| **Related PRD** | [`../pulse-extension/website-portal-requirements.md`](../pulse-extension/website-portal-requirements.md) |
| **Technical design** | [`design.md`](design.md) |
| **Task ledger** | [`tasks.md`](tasks.md) |
| **Extension Figma (secondary)** | [`../pulse-extension/figma-handoff.md`](../pulse-extension/figma-handoff.md) |

## 1. Decision

The StreamPulse analytics surface must be built from the **Figma Make redesign** first. It must not mix three different products in one route:

- Public aggregate hub (`hubx` command center)
- Figma session dashboard
- Internal Streamclone analytics console

The public route `/analytics` is the StreamPulse analytics mockup entry point — the hub/search landing. It should look intentional at first paint, even when backend data is empty. Backend data can enrich the mockup, but absence of data must not collapse the page into a sparse internal console or a generic command-center dashboard.

> **Scope clarification (channel routes).** This Figma-first contract governs the **`/analytics` landing only**. Per-channel routes (`/analytics/:channelLogin` and `/analytics/:channelLogin/:streamId`) render the shared **Streamclone analytics console** (`@streamclone/analytics-console`) by default so the public channel view matches Streamclone analytics one-to-one. The Figma session dashboard is an opt-in design-review surface behind `?figma=1`, **not** the default. There is no `login`/beta-key/account flow on any analytics route — analytics is public and no-login.

## 2. Source Of Truth

### Primary (authoritative)

| Resource | Role |
|---|---|
| [Figma Make URL](https://www.figma.com/make/C35yDLsXdkoRyDvnlxd5gr/StreamPulse-Analytics-Page-Redesign) | Layout, density, section order, interaction model |
| Make source `src/app/App.tsx` | Screen blueprint — Nav → Hero → SessionHeader → SignalChart grid → EmoteSignal → CorpusPipeline |
| Make inline theme `T` object in `App.tsx` | Hardcoded slate palette used for pixel parity |
| Make source `src/styles/theme.css` | shadcn token baseline (secondary reference) |

Fetched via Figma MCP (`get_design_context`, `FetchMcpResource`) as `file://figma/make/source/C35yDLsXdkoRyDvnlxd5gr/...`.

### Secondary (visual language only)

Extension PNG handoff — use for Pulse panel language and extension parity, **not** for `/analytics` page layout:

- [`../pulse-extension/figma/hero-on-twitch.png`](../pulse-extension/figma/hero-on-twitch.png)
- [`../pulse-extension/figma/expanded-panel.png`](../pulse-extension/figma/expanded-panel.png)
- [`../pulse-extension/figma/per-signal-lanes.png`](../pulse-extension/figma/per-signal-lanes.png)

Website evidence PNGs (`../design/evidence/streampulse-analytics-xqc-*.png`) are regression snapshots only.

If Make and extension PNGs differ on `/analytics`, **Make wins**.

## 3. Route Contract

| Route | Component | Role |
|---|---|---|
| `/analytics` | `AnalyticsLandingPage` | Figma Make landing — hub/search entry: hero, featured session, emote signal, corpus pipeline |
| `/analytics/hub` | redirect → `/analytics` | Legacy alias |
| `/analytics/:channelLogin` | `ChannelAnalyticsPage` → `AnalyticsConsole` | **Streamclone analytics console** for the channel (default, no Figma shell) |
| `/analytics/:channelLogin/:streamId` | `ChannelAnalyticsPage` → `AnalyticsConsole` | Same console, opened on a specific stream (canonical session route) |
| `/analytics/:channelLogin/s/:streamId` | redirect → `/analytics/:channelLogin/:streamId` | Backcompat alias for old `/s/` links |
| `/analytics/:channelLogin?figma=1` | `ChannelAnalyticsPage` → Figma session dashboard | Opt-in design-review surface (not default) |
| `/dashboard/*` | Dashboard | Separate, gated product surface (not part of public analytics) |

**Decoupling rules:**

- `/analytics` (landing) MUST NOT render `DashboardHome`, `hubx`, or `hub.css`.
- `/analytics/:channelLogin` renders `AnalyticsConsole` directly (full Streamclone parity); it MUST NOT be wrapped in the Figma shell by default.
- The Figma session dashboard is opt-in via `?figma=1` only.
- The **default** public channel console shows game/category segment overlays when backend data exists (`AnalyticsConsole showGameSegments={true}`) to match Streamclone `:8090`. The optional `?figma=1` review surface may hide segments for layout review; that is not the canonical channel console.
- No analytics route requires login. The legacy `/login` beta-key screen is removed and redirects to `/analytics`.

Implementation files:

- [`../../streampulse-web/src/routes/analytics/AnalyticsLandingPage.tsx`](../../streampulse-web/src/routes/analytics/AnalyticsLandingPage.tsx)
- [`../../streampulse-web/src/routes/index.tsx`](../../streampulse-web/src/routes/index.tsx)

## 4. Current Drift To Remove

Blockers resolved by this contract:

- ~~`/analytics` maps to `DashboardHome`~~ → route to `AnalyticsLandingPage`
- ~~`FigmaSessionDashboard` embedded inside hub shell~~ → primary content on `/analytics`
- ~~Channel routes default to the Figma shell / required `?console=1`~~ → channel routes render `AnalyticsConsole` directly; Figma dashboard is `?figma=1` opt-in
- ~~Game/category overlays on the public chart~~ → **default channel console matches `:8090`** (`showGameSegments={true}` when data exists); Figma `?figma=1` opt-in may hide segments for design review only
- ~~`/login` beta-key screen in the analytics flow~~ → removed; `/login` redirects to `/analytics`
- ~~Live streamer rail page-level overflow~~ → contained scrollport (`.figma-live-rail__track`)

## 5. Make Screen Blueprint

> **Landing hierarchy (2026-06):** See [`analytics-command-center-layout.md`](analytics-command-center-layout.md) for the current section order, allowed KPIs, dedup rules, and sidebar anchors. The list below is the original Make export; Pulse Moments is now the hero row above Network Activity.

Section order from Make `App.tsx` (top → bottom):

1. **Sticky top nav** — StreamPulse mark, search, live pill, Analytics / Emotes tabs, backend status
2. **Command-center hero** — 3-column grid:
   - Left: command-center metric rail (live channels, global activity, emote economy, recent streams)
   - Center: headline, search, live channel cards (fixed-width, horizontal scroll inside track)
   - Right: coverage / pipeline / quick-status stack
3. **Corpus snapshot strip** — channels tracked, total emotes, chat processed, streams indexed
4. **Session header** — xQc / Minecraft featured session (or demo when hub empty): avatar, stats row, VOD actions
5. **Multi-signal chart** — normalized 4-trace chart + moment chips
6. **Dashboard grid** (3 columns):
   - Live sessions table + coverage truth
   - Most reacted minutes table
   - Moment inspector + top emote bursts
7. **Emote signal** — KPI row, filterable live channel table, emote economy sidebar
8. **Corpus pipeline** — metadata tracker, silver/gold tiers, moments feed, critical banner

### Make theme tokens (inline `T` — canonical for `/analytics`)

| Token | Value | Usage |
|---|---|---|
| `bg` | `#09090b` | Page canvas |
| `navBg` | `rgba(9,9,11,0.94)` | Sticky nav |
| `panel` | `rgba(255,255,255,0.028)` | Card surfaces |
| `panelAlt` | `rgba(99,102,241,0.055)` | Session header tint |
| `border` | `rgba(255,255,255,0.075)` | Dividers |
| `borderAccent` | `rgba(99,102,241,0.38)` | Accent borders |
| `accent` | `#6366f1` | Primary violet |
| `accentText` | `#818cf8` | Links, highlights |
| `green` | `#4ade80` | Live / synced |
| `cyan` | `#22d3ee` | 7TV / emote traces |
| `amber` | `#fbbf24` | Heat / warnings |
| `red` | `#f87171` | Live dot / critical |

CSS variables live in [`../../streampulse-web/src/ui/components/analytics/figma-analytics.css`](../../streampulse-web/src/ui/components/analytics/figma-analytics.css) as `--fma-*`.

## 6. Component Linkage

| Make section | Implementation |
|---|---|
| Nav + shell | [`AnalyticsFigmaShell.tsx`](../../streampulse-web/src/ui/components/analytics/AnalyticsFigmaShell.tsx) + [`AnalyticsHubSidebar.tsx`](../../streampulse-web/src/ui/components/analytics/AnalyticsHubSidebar.tsx) |
| Session header | [`FigmaSessionHeaderStrip.tsx`](../../streampulse-web/src/ui/components/analytics/FigmaSessionHeaderStrip.tsx) |
| Hub activity + moments | [`FigmaGlobalActivityPanel.tsx`](../../streampulse-web/src/ui/components/analytics/FigmaGlobalActivityPanel.tsx) + [`PulseMomentsLivePanel.tsx`](../../streampulse-web/src/ui/components/analytics/PulseMomentsLivePanel.tsx) |
| Channel session (default) | `@streampulse/analytics-console` via [`ConsoleChannelView.tsx`](../../streampulse-web/src/routes/analytics/ConsoleChannelView.tsx) |
| Channel session (`?figma=1`) | [`FigmaChannelDashboard.tsx`](../../streampulse-web/src/ui/components/analytics/FigmaChannelDashboard.tsx) |
| Live channel rail | [`FigmaLiveChannelRail.tsx`](../../streampulse-web/src/ui/components/analytics/FigmaLiveChannelRail.tsx) |
| Emote signal | [`FigmaEmoteSignalBlock.tsx`](../../streampulse-web/src/ui/components/analytics/FigmaEmoteSignalBlock.tsx) |
| Styles | [`figma-analytics.css`](../../streampulse-web/src/ui/components/analytics/figma-analytics.css) |

**Do not use on the `/analytics` landing:**

- [`Home.tsx`](../../streampulse-web/src/routes/dashboard/Home.tsx) / `hubx`
- [`hub.css`](../../streampulse-web/src/ui/components/hub/hub.css)
- `@streampulse/analytics-console` — the console is the default surface for
  **channel routes**, not for the aggregate landing (source is owned by
  `streampulse-backend/packages/analytics-console`).

## 7. Data Requirements

Figma parity is presentation-first, but data must stay honest:

- Prefer backend featured session from `/v1/public/hub` when `featuredSession.state === 'ready'`.
- When hub has no qualifying session, show polished empty/degraded shell with honest copy — **never** inject deterministic xQc or other fake session data on production routes.
- Landing scroll demos (`LiveSignalScrollGraph`, `TrackedChannels` fallback) must read as illustrative, not live backend truth.
- Keep empty backend states visually complete — polished shell + honest copy.
- Never compute Pulse scores client-side.
- Never fetch full timelines during hub polling.

### Data states

| State | Trigger | UI behavior |
|---|---|---|
| `loading` | Hub fetch in flight, no cache | Skeleton hero + session placeholder |
| `ready` | Hub featured session qualifies | Bind all session panels to backend model |
| `empty` | Hub empty / no qualifying session | Polished shell + honest empty copy (no fake session) |
| `degraded` | Hub error with stale cache | Show cached counts + degraded status pill |

## 8. Acceptance Criteria

- `/analytics` renders `AnalyticsLandingPage` with Figma Make section order, not `hubx`.
- `/analytics` has **no page-level horizontal scrollbar** at 1366px, 1440px, or 1600px viewport widths.
- `/analytics` first paint looks like a complete product when `/v1/public/hub` has no qualifying featured session (empty/degraded shell — not fake xQc data).
- `/analytics/:channelLogin` and `/analytics/:channelLogin/:streamId` render `AnalyticsConsole` directly with `showGameSegments={false}` (no game overlays, no Figma shell).
- `/analytics/:channelLogin/s/:streamId` redirects to the canonical `/analytics/:channelLogin/:streamId`.
- No analytics route requires login; the public chart shows no game/category overlays.
- Playwright/route tests cover `/analytics`, `/analytics/xqc`, `/analytics/xqc/{streamId}`, and the `/s/` alias redirect.

## 9. Implementation Steps

1. Route `/analytics` → `AnalyticsLandingPage`; `/analytics/hub` → redirect to `/analytics`.
2. Use `AnalyticsFigmaShell` as the hub/landing shell (not the channel console wrapper).
3. Port Make layout sections into figma-scoped components + CSS tokens.
4. Render `AnalyticsConsole` directly on channel routes with `showGameSegments={false}`; expose the Figma session dashboard via `?figma=1` only.

## 10. Verification

Manual:

```bash
cd streampulse-web
npm run dev
```

Open:

- `http://localhost:5174/analytics`
- `http://localhost:5174/analytics/xqc`
- `http://localhost:5174/analytics/xqc/<fixture-stream-id>` (canonical session route)
- `http://localhost:5174/analytics/xqc/s/<fixture-stream-id>` (redirects to the canonical route)

Automated:

```bash
cd streampulse-web
npm run typecheck
npm test
npx playwright test tests/e2e/analytics-figma-parity.spec.ts
```

Visual regression: compare section-by-section against Make `App.tsx` and Figma Make preview.
