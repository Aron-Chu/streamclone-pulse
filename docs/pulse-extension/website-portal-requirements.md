# StreamPulse — Public Website &amp; User Portal Requirements

> Product Requirements Document (PRD) for the public website and account portal of the **Streamclone Pulse** Chrome extension.
> Domain: `streampulse.stream` · API: `https://api.streampulse.stream` · Backend: Streamclone analytics on **streampulse-vps**, fronted by Cloudflare (operator deploy in private **streampulse-ops**).

| | |
|---|---|
| **Document status** | Draft v1 — for review |
| **Owner** | Aron-Chu |
| **Audience** | Product, frontend, backend, infra |
| **Related specs** | [`requirements.md`](./requirements.md) (extension R1–R13), [`design.md`](./design.md) (architecture/API), [`tasks.md`](./tasks.md), [`figma-handoff.md`](./figma-handoff.md) |
| **Source of truth** | Streamclone analytics backend (`internal/analytics/extension_api.go`, `pulse_coverage.go`, `pulse_backfill.go`, `pulse_hosted.go`) |

---

## Naming &amp; brand reconciliation (read first)

The product family already ships under **Streamclone Pulse** (the extension) talking to the Streamclone backend. This PRD adopts:

| Surface | Name used | Notes |
|---------|-----------|-------|
| Company / engine | **Streamclone** | Existing repo + analytics engine. Do not rebrand. |
| Extension | **Streamclone Pulse** | Chrome MV3 companion (this repo). |
| Public website / portal | **StreamPulse** | Consumer-facing web brand at `streampulse.stream`. |
| Hosted API | `api.streampulse.stream` | Supersedes the placeholder `api.streamclone.app` in older docs. |

Throughout this doc, **StreamPulse** = the website/portal; **Pulse** = the analytics concept shared by extension + web; **Streamclone** = the backend engine.

---

## 1. Executive summary

StreamPulse is the public home and account portal for the Streamclone Pulse Chrome extension. The extension answers one question on the Twitch page itself — *"I joined late, what did I miss?"* — by overlaying live chat activity, 7TV/emote spikes, "Most Reacted So Far" moments, coverage state, and a "Load missed moments" backfill flow. The website extends that promise off-Twitch: it explains the product, distributes/configures the extension, and gives a **hosted dashboard** for tracked channels, saved moments, clip candidates, past-stream analytics, and the same "load missed moments" flow.

The visual language is **dark, Twitch-native, data-platform**: near-black surfaces, violet/purple primaries, and orange→yellow heatmap accents reserved for live intensity and peak scores. Structurally the site borrows the confident simplicity of a clean data product (clear hero, top nav, product/dashboard/resources links, a credibility statistics band, minimal layout) but reads as **stream intelligence**, not a fan page.

The backend is the existing Streamclone analytics engine running on **streampulse-vps**, fronted by Cloudflare DNS/Tunnel at `api.streampulse.stream`. Production env and deploy live in private **streampulse-ops** — not public `profile-bearhost-pulse.env`. The site is **read-mostly and rollup-first**: it never stores raw chat for all streams, never exposes unauthenticated tracking endpoints, and enforces a single shared tracking session per channel.

> **Historical:** BearHost (`141.11.243.103`) was pre-2026-07-02 production; it is **rollback/archive only**. See streamclone [`docs/streampulse-vps.md`](https://github.com/Aron-Chu/streamclone/blob/master/docs/streampulse-vps.md).

**MVP** ships a marketing landing page, an extension setup page, a thin dashboard (watchlist, saved moments, past streams), beta-key/device auth, and a public backend status page — no billing, no heavy multi-tenant backfill. **V2** adds device auth, D1-backed user data, a clip-candidate queue, and shareable moment pages. **V3** adds paid hosted Pulse, tiers/billing, streamer-owned dashboards, and an official Twitch Extension.

### Success metrics (north stars)

| Metric | MVP target | Why |
|--------|-----------|-----|
| Extension installs from site | Track funnel | Primary conversion |
| Beta keys activated → first tracked channel | &gt; 60% | Onboarding health |
| Dashboard 7-day return | &gt; 30% | Stickiness via saved moments |
| "Load missed moments" jobs completed vs started | &gt; 80% | Backfill honesty/quality |
| API p95 latency (BFF) | &lt; 150ms cache-miss | Perf budget (design.md §9) |

---

## 2. Product positioning

**One-liner:** *Stream intelligence for Twitch — never miss the moment that mattered.*

**Positioning statement:** For Twitch viewers, streamers, editors, and clip hunters who can't watch every second live, StreamPulse is a live analytics layer that surfaces the most-reacted moments in real time and lets you load what you missed — unlike clip sites or VOD scrubbing, it reads chat + emote intensity as it happens and is honest about coverage.

| Axis | StreamPulse stance |
|------|--------------------|
| Not a… | clip-farming site, chat logger, fan wiki, generic analytics SaaS dashboard |
| Is a… | live "stream intelligence" companion + hosted Pulse dashboard |
| Tone | technical, confident, honest about data gaps (never fake moments) |
| Visual | dark Twitch-native, purple/violet, near-black, orange/yellow heatmap accents |
| Trust | rollup-first, privacy-conscious, "shared tracking session per channel" |

**Differentiators to message:** real-time "Most Reacted So Far," per-signal lanes (chat vs 7TV vs viewers), honest coverage ("Showing moments from 00:15 → live"), and backfill that tells you the truth when a VOD isn't ready.

---

## 3. Core user jobs-to-be-done

Five user groups, each with a primary job, the surface that serves it, and the honesty constraint that protects trust.

| # | User group | Job ("When I…, I want to…, so I can…") | Primary surface | Honesty constraint |
|---|-----------|------------------------------------------|-----------------|--------------------|
| 1 | **Late-joining viewer** | When I join a stream late, I want to see the top moments since it started, so I can catch up without scrubbing the VOD. | Extension overlay + `/dashboard/c/{login}` | Show coverage start; offer "Load missed moments"; never invent peaks. |
| 2 | **Streamer** | When my stream ends, I want a recap of my best moments and emote spikes, so I can understand what landed. | `/dashboard/c/{login}` recap + past streams | Recap derived from same rollups as live; no fabricated engagement. |
| 3 | **Editor / clipper** | When I review a stream, I want a ranked queue of clip-worthy moments with start/end + reason, so I can cut clips fast. | `/dashboard/clips` (V2) | Confidence score + reason are explainable; "new/saved/dismissed/exported" states. |
| 4 | **Beta user** | When I install the extension, I want to connect it to the hosted backend, so I get Pulse without running Streamclone locally. | `/setup` + extension options | Clear beta-key flow + health check + troubleshooting. |
| 5 | **Admin / operator** | When the service is live, I want to monitor backend health and tracking limits, so I can keep it within capacity. | `/admin` (private) | Private-only; Grafana never public; show caps + active channels. |

**JTBD acceptance signal:** each group can complete its primary job end-to-end from the website within the MVP (groups 1, 2, 4, 5) or V2 (group 3) without leaving for raw Streamclone analytics, except via an explicit "Open full analytics" deep link.

---

## 4. Sitemap / information architecture

### 4.1 Top-level navigation

```text
StreamPulse (logo)   Product   Dashboard   Docs   Status   [Install extension]  [Open dashboard / Sign in]
```

- **Public (unauthenticated):** Product (landing), Docs, Status, Setup.
- **Authenticated (beta key / device):** Dashboard and all sub-pages, Account.
- **Private (operator):** Admin (separate auth, not in public nav).

### 4.2 Route map

| Route | Page | Auth | Phase |
|-------|------|------|-------|
| `/` | Landing / marketing home | Public | MVP |
| `/setup` | Install &amp; connect the extension | Public | MVP |
| `/docs` | Documentation index | Public | MVP |
| `/docs/*` | Doc articles (setup, API, privacy) | Public | MVP |
| `/status` | Public backend status (proxied health) | Public | MVP |
| `/roadmap` | Roadmap / changelog (links GitHub) | Public | MVP |
| `/login` | Beta key / device claim | Public | MVP |
| `/dashboard` | Home dashboard | Auth | MVP |
| `/dashboard/watchlist` | Watchlist management | Auth | MVP |
| `/dashboard/c/{login}` | Channel page (live + recent + moments) | Auth | MVP |
| `/dashboard/c/{login}/s/{streamId}` | Single stream analytics | Auth | MVP |
| `/dashboard/moments` | Saved moments library | Auth | MVP |
| `/dashboard/clips` | Clip candidate queue | Auth | V2 |
| `/dashboard/streams` | Past streams (all tracked channels) | Auth | MVP |
| `/dashboard/connection` | Extension connection / config | Auth | MVP |
| `/dashboard/account` | Account / device / key management | Auth | MVP (basic) → V2 |
| `/m/{momentId}` | Public shareable moment page | Public | V2 |
| `/admin` | Operator console | Operator | MVP (basic) |
| `/admin/channels` | Tracked-channel registry + caps | Operator | MVP |
| `/admin/jobs` | Backfill job monitor | Operator | V2 |

### 4.3 IA principles

- **Current live stream is always a distinct surface** from past streams (mirrors `CurrentStreamCard` vs `PastVodsSection` in the extension). Never merge live into the "Past streams" list.
- **Coverage is a first-class object** on every channel/stream view (not buried) — it drives the "Load missed moments" CTA.
- **Open full analytics** is a deep link out to the Streamclone web app for power users; the portal is the curated layer.
- **Analytics is experienced through channels and streams, not a separate console.** The dashboard nav (`Dashboard · Watchlist · Moments · Streams · Analytics · Settings`) lists an **Analytics** item, but it resolves to `/dashboard/c/{login}` → `/dashboard/c/{login}/s/{streamId}` (and `/dashboard/streams`), never a raw internal Analytics UI.
- **Pulse vs Analytics levels** (§10.0): compact "Pulse" on channel cards; full "Analytics" on the single-stream page.

---

## 5. Landing page requirements

**Goal:** explain the product in &lt; 10 seconds, drive install/dashboard/beta, and establish data-platform credibility. Structure adapted from a clean data-product landing (hero → how-it-works → stats → features → resources), restyled to Streamclone's dark/heatmap identity.

### 5.1 Section spec

| # | Section | Required content | Notes |
|---|---------|------------------|-------|
| L1 | **Hero** | Headline, subhead, 3 CTAs, live product mockup | Above the fold |
| L2 | **How it works** | 4 numbered steps | Open Twitch → Track Pulse → See spikes/top moments → Load missed moments |
| L3 | **Statistics band** | 5 live counters | Credibility, pulled from backend aggregates |
| L4 | **Feature cards** | 6 cards | Heatmap, spike inspector, Most Reacted, load missed, saved/clips, past analytics |
| L5 | **Who it's for** | 4 audience tiles | Viewers / streamers / editors / clip hunters |
| L6 | **Resources** | 5 links | Docs, setup, API status, GitHub/roadmap, community |
| L7 | **Footer CTA + footer** | Repeat install CTA, legal, privacy | |

### 5.2 Hero copy (exact suggestions)

```text
Eyebrow:   LIVE STREAM INTELLIGENCE FOR TWITCH
Headline:  Never miss the moment that mattered.
Subhead:   StreamPulse overlays live chat and emote spikes on Twitch and tells you
           exactly what you missed — the second you join.
CTA-1:     Install Chrome Extension      (primary, violet)
CTA-2:     Open Dashboard                (secondary, outline)
CTA-3:     Join the Beta                 (ghost / text)
```

- **Hero mockup:** a framed, slightly-angled Twitch player with the Pulse overlay docked right: mini heatmap lane (purple→orange gradient), "Most Reacted So Far" list, and a "Showing moments from 00:15 → live · Load missed moments" coverage chip. Use a static high-fidelity image/animation, not a live embed.

### 5.3 How it works (exact copy)

```text
1. Open Twitch        — Go to any live channel.
2. Track Pulse        — StreamPulse asks Streamclone to start tracking chat + emotes.
3. See spikes & moments — Watch the live heatmap and a ranked "Most Reacted So Far".
4. Load missed moments — Joined late? Pull the earlier chat once the VOD is available.
```

### 5.4 Statistics band

Five counters, fed by a cached public aggregate endpoint (`GET /v1/public/stats`, see §14). Each shows a number + label; animate count-up on scroll; show "updated &lt;relative time&gt;".

| Counter | Label | Source |
|---------|-------|--------|
| Streams tracked | `Streams tracked` | `count(streams)` |
| Moments detected | `Moments detected` | `count(peaks)` across streams |
| Chat messages processed | `Chat messages processed` | sum of rollup `chatCount` |
| Emotes indexed | `Emotes indexed` | distinct emotes in dictionaries |
| VODs analyzed | `VODs analyzed` | `count(streams where vodId not null)` |

> Honesty rule: stats are **aggregate counts only** (no per-user or per-channel PII), cached, and labeled as approximate ("4.2M+"). If the aggregate endpoint is unavailable, hide the band rather than show zeros.

### 5.5 Feature cards (title + one-liner)

| Card | Title | Copy |
|------|-------|------|
| 1 | **Live Pulse heatmap** | A real-time intensity lane of chat + emotes, minute by minute. |
| 2 | **7TV / emote spike inspector** | See which emotes drove a moment — KEKW, OMEGALUL, and the rest. |
| 3 | **Most Reacted So Far** | A ranked list of the stream's biggest moments, scored as they happen. |
| 4 | **Load missed moments** | Joined late? Backfill the earlier chat from the VOD when it's ready. |
| 5 | **Saved moments &amp; clip queue** | Bookmark anything worth remembering; build a clip-worthy queue. |
| 6 | **Past stream analytics** | Open any ended stream and replay its peaks, emotes, and totals. |

### 5.6 Landing acceptance

- Hero, stats band, and at least 6 feature cards render with no layout shift on a 360px → 1440px range.
- All three hero CTAs route correctly (`/setup` install detection, `/dashboard`, `/login`).
- Stats band degrades gracefully (hidden) when `/v1/public/stats` fails.
- Lighthouse performance ≥ 90 on the landing page (static-first, no live data on critical path).

---

## 6. Dashboard requirements

**Route:** `/dashboard`. The home dashboard is a curated overview of the user's tracked world, mirroring the extension's information model so the two feel like one product.

### 6.1 Home dashboard layout

```text
┌ Header: StreamPulse · [channel search]            [connection status ●] [account] ┐
├ LIVE NOW (tracked channels currently live) ──────────────────────────────────────┤
│  [CurrentStreamCard]  [CurrentStreamCard]   …   (purple "LIVE" badge, mini heat)  │
├ WATCHLIST (always-tracked) ───────────────────────────────────────────────────────┤
│  rows: avatar · login · status badge · last stream · [open] [analytics]          │
├ RECENT STREAMS (across tracked channels) ─────────────────────────────────────────┤
│  thumbnail · title · ended · sync badge                                           │
├ SAVED MOMENTS (latest) ───────────────────────────────────────────────────────────┤
│  moment rows: title · timestamp · score · top emotes · [jump]                     │
└────────────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Home dashboard requirements

| ID | Requirement |
|----|-------------|
| D1 | SHALL show a **Live now** band of tracked channels currently live, each as a `CurrentStreamCard` (live badge, coverage chip, mini heat lane, "Open"). |
| D2 | SHALL show the **watchlist** with per-channel status badges (§8). |
| D3 | SHALL show **recent ended streams** across tracked channels (thumbnail + title + sync badge), excluding any currently-live stream (live lives in D1 only). |
| D4 | SHALL show the **latest saved moments** with jump links. |
| D5 | SHALL show a global **connection status** indicator (backend reachable / beta-key valid / degraded). |
| D6 | SHALL provide a channel quick-add / search to jump to any `/dashboard/c/{login}`. |
| D7 | Empty state SHALL guide first-run users to add a channel or install the extension (§17). |

### 6.3 Visual system (design tokens)

| Token | Value (suggested) | Use |
|-------|-------------------|-----|
| `--bg-base` | `#0a0a0f` | App background (near-black) |
| `--bg-surface` | `#14141c` | Cards |
| `--bg-elevated` | `#1d1d28` | Hover / elevated |
| `--violet-500` | `#8b5cf6` | Primary brand, CTAs |
| `--purple-600` | `#7c3aed` | Pressed / accents |
| `--heat-low` | `#4c1d95` | Heatmap min (deep purple) |
| `--heat-mid` | `#a855f7` → `#f97316` | Heatmap ramp |
| `--heat-high` | `#fbbf24` | Peak intensity (yellow) |
| `--live` | `#ef4444`/`#f97316` | LIVE badge accent |
| `--text-primary` | `#f4f4f7` | Body |
| `--text-muted` | `#8b8b9e` | Secondary / "Collecting" |

> Heatmap accent (orange/yellow) is **reserved** for intensity/peak scoring so it stays meaningful; never use it for generic buttons.

---

## 7. Extension connection flow

**Route:** `/setup` (public) and `/dashboard/connection` (authed). This is the bridge from website → installed extension → hosted backend.

### 7.1 Setup page steps

```text
Step 1 — Install      [Add to Chrome]  (detect if already installed)
Step 2 — Connect      Backend URL: https://api.streampulse.stream  [Copy]
                      Beta key:    ____-____-____   [Get a beta key]
Step 3 — Verify       [Run health check]  →  ● Connected (version, latency)
Step 4 — Track        Open any Twitch channel, click Pulse, Start tracking.
```

### 7.2 Connection requirements

| ID | Requirement |
|----|-------------|
| C1 | SHALL display the canonical backend URL (`https://api.streampulse.stream`) with a **Copy config** button that copies a JSON blob the extension options can import. |
| C2 | SHALL provide a **beta key / device key** field and a "Get a beta key" path (`/login`). |
| C3 | SHALL run a **health check** against `GET /v1/extension/health` and show `ok`, `version`, round-trip latency. |
| C4 | SHALL detect extension installation (via a content-script-injected handshake or `externally_connectable` ping) and adapt copy ("Installed ✓" vs "Add to Chrome"). |
| C5 | SHALL surface troubleshooting states (§7.3) with actionable next steps. |
| C6 | The copied config SHALL match the extension options schema: `{ backendUrl, betaKey, pollIntervalMs }`. |

### 7.3 Troubleshooting states (exact copy)

| State | Cause | Copy + action |
|-------|-------|---------------|
| `not_installed` | Extension absent | "Install the StreamPulse extension to connect." → Add to Chrome |
| `unreachable` | Health check fails | "Can't reach StreamPulse at &lt;url&gt;. Check your connection or try again." → Retry |
| `unauthorized` | Missing/bad beta key (401 + `hint`) | "This beta needs a key. Paste your beta key in the extension options." → Get a key |
| `mixed_content` | Extension pointed at `http://` non-localhost | "The backend URL must be https. Update it to https://api.streampulse.stream." |
| `version_mismatch` | Extension older than backend | "Update the extension for the latest Pulse features." |
| `connected` | All good | "● Connected — Streamclone &lt;version&gt;, &lt;latency&gt;ms." |

> The `unauthorized` copy and `hint` mirror the real backend response in `pulse_hosted.go` (`X-Streamclone-Beta-Key`).

### 7.4 Copy-config payload (example)

```json
{
  "backendUrl": "https://api.streampulse.stream",
  "betaKey": "PULSE-XXXX-XXXX-XXXX",
  "pollIntervalMs": 30000
}
```

---

## 8. Watchlist management

**Route:** `/dashboard/watchlist`. The watchlist is the user's set of channels they care about; "always-track" channels are kept in the shared tracking pool subject to caps (§18).

### 8.1 Requirements

| ID | Requirement |
|----|-------------|
| W1 | SHALL let a user add a channel by Twitch login (validated against `/v1/analytics/channels/{login}` existence). |
| W2 | SHALL let a user toggle **Always track** per channel (subject to per-user channel cap, §18). |
| W3 | SHALL show a **tracking status badge** per channel (table below), sourced from backend state, never assumed. |
| W4 | SHALL let a user remove a channel (decrements the shared tracking-pool refcount; does not stop others' tracking). |
| W5 | SHALL show "last stream" + quick links (Open channel, Open Twitch, Open analytics). |
| W6 | Adding a channel SHALL NOT create a per-user IRC session — it joins the **one shared session** for that channel (§18). |

### 8.2 Tracking status badges

| Badge | Meaning | Derived from |
|-------|---------|--------------|
| `LIVE` | Channel live + tracked | `isLive &amp;&amp; tracking` |
| `Offline` | Not live | `!isLive` |
| `Warming` | Tracked, &lt; 5 completed rollups | `tracking &amp;&amp; completedRollups &lt; extPulseMinCompleted` |
| `Synced` | Full coverage available | `coverage.hasFullStreamCoverage` |
| `Partial` | Tracking started late / gaps | `coverage.state ∈ {partial_tracking, missing_ranges_detected}` |
| `Not tracked` | In watchlist but tracking off | `!tracking` |

### 8.3 Watchlist row (example)

```text
[avatar] xQc            LIVE · Partial coverage (from 00:14)   last: 6h ago   [Open] [Twitch] [⋯]
[avatar] sodapoppin     Offline · Synced                        last: 1d ago   [Open] [Twitch] [⋯]
[avatar] pokimane       Warming · collecting…                   live now       [Open] [Twitch] [⋯]
```

---

## 9. Saved moments / clip queue

### 9.1 Saved moments — `/dashboard/moments`

Backed by the existing `pulse_bookmarks` table and `/v1/pulse/bookmarks` CRUD (design.md §5.1, §6.3). A saved moment is a **private memory marker**; it never auto-creates a public clip (extension R10.2).

| ID | Requirement |
|----|-------------|
| M1 | SHALL show a searchable, filterable list of saved moments (filter by channel, stream, tag, date). |
| M2 | Each row SHALL show: stream title, timestamp (`offsetSeconds` formatted), score, reason label, top emotes, notes, tags. |
| M3 | Each row SHALL offer **Jump** (VOD deep link once resolved), **Open analytics**, **Copy link**, **Export**. |
| M4 | SHALL let users edit `label`/`notes`/tags (PATCH) and delete (DELETE, idempotent). |
| M5 | `offsetSeconds` is canonical and SHALL resolve to a VOD deep link once `vodId` exists (R10.5). |
| M6 | Moments created in extension vs web SHALL be the same records (`source` field), single source of truth. |
| M7 | Export SHALL support CSV + JSON of the filtered set (no raw chat included). |

### 9.2 Saved moment row (example)

```text
"team wipe on final circle"   xQc · 00:52:14   score 95   7TV spike   [KEKW ×214] 
tags: clipworthy, funny       notes: "maybe clip later"
[Jump] [Open analytics] [Copy link] [Export]
```

### 9.3 Clip candidates — `/dashboard/clips` (V2)

A ranked queue of algorithmically-detected clip-worthy moments (derived from peaks + recap clip candidates), distinct from manually saved moments.

| ID | Requirement |
|----|-------------|
| K1 | SHALL show each candidate with a **confidence score** (0–100) and a **reason explanation** (e.g. "Chat +320%, KEKW burst"). |
| K2 | SHALL suggest a **clip title** (editable) and a **start/end range** (default ±15s around peak, adjustable). |
| K3 | SHALL track status: `new`, `saved`, `dismissed`, `exported`. |
| K4 | SHALL let editors bulk-dismiss/save and export ranges to the clipper (ReplayForge / Clip Studio handoff). |
| K5 | Candidates SHALL be derived from the same scoring as live Pulse (`pulse-core`) so ranking is consistent. |
| K6 | Dismissing a candidate SHALL be a per-user signal (does not affect other users' queues). |

### 9.4 Clip candidate card (example)

```text
CLIP CANDIDATE · confidence 92
xQc — 01:14:30 → 01:15:10  (40s)
Why: chat +280% over baseline, OMEGALUL burst (×180), viewer bump
Suggested title: "xQc loses it at the final boss"
[Save] [Adjust range] [Export to clipper] [Dismiss]   status: new
```

---

## 10. Analytics integration — channel & stream review (Analytics-Lite)

**Routes:** `/dashboard/streams` (all channels), `/dashboard/c/{login}` (per channel), `/dashboard/c/{login}/s/{streamId}` (single stream).

### 10.0 Positioning — curated Analytics-Lite, not the power console

StreamPulse **incorporates** Streamclone Analytics, but as a polished, user-facing layer — **not** by embedding the internal `Analytics.tsx` console. Same Postgres rollups/peaks/coverage/recap/sync source of truth; different presentation and a hidden surface.

| Surface | Role |
|---------|------|
| Streamclone Pulse (extension) | Live, in-context overlay on Twitch. |
| **StreamPulse website (this doc)** | **Curated Analytics-Lite:** channel/stream review, saved moments, load-missed-moments, recaps — explains data quality honestly. |
| Streamclone Analytics app | Internal/power-user console: full sync controls, scraper internals, diagnostics, corpus/archive, global picker. |

**Two presentation levels** (both powered by the same analytics backend):

| Level | Shows | Where |
|-------|-------|-------|
| **Pulse** | top moments, heatmap, emote spikes, coverage | Channel page + compact cards |
| **Analytics** | viewer lines, game/category segments, source details, sync health, summary metrics | Single stream page |

> Splitting Pulse from Analytics keeps the site simple for normal viewers while still being fully analytics-powered for editors/streamers.

### 10.0.1 Not exposed publicly (operator-gate or hide)

These exist in Streamclone Analytics but SHALL NOT appear in the user-facing portal (operator-only behind Cloudflare Access, or hidden entirely):

`raw sync diagnostics` · `scraper internals` · `GQL concurrency/debug fields` · `archive export controls` · `silver/gold corpus controls` · `Grafana/Influx dashboards` · `global stream picker across all users` · `admin tracking snapshot` · `raw VOD chat messages`.

A normal user MAY open an **Advanced** drawer on the single-stream page to see a *read-only, sanitized* sync summary; raw GQL/scraper internals stay operator-only.

### 10.1 Channel page — `/dashboard/c/{login}`

| ID | Requirement |
|----|-------------|
| CH1 | SHALL show **current live status** as a distinct `CurrentStreamCard` when live (never inside past list). |
| CH2 | SHALL show **recent ended streams** (past VODs only). |
| CH3 | SHALL show **top moments** ("Most Reacted So Far" live, or stream recap when ended) with scores + reasons. |
| CH4 | SHALL show **emote spikes** / emote lanes (top emotes per peak). |
| CH5 | SHALL show a **coverage card** + "Load missed moments" CTA (§11) when coverage is partial. |
| CH6 | SHALL offer **Open Twitch** and **Open full analytics** deep links. |

### 10.2 Past streams list requirements

| ID | Requirement |
|----|-------------|
| P1 | SHALL list **ended VODs only**; a currently-live stream SHALL appear as a separate "Current stream" card, not in this list. |
| P2 | Each row SHALL show thumbnail, title, ended-at, duration, peak count, and a **sync status badge**. |
| P3 | SHALL be collapsible (default 3 rows + "View all"), matching the extension's `PastVodsSection`. |
| P4 | Selecting a stream SHALL open `/dashboard/c/{login}/s/{streamId}`. |

### 10.3 Sync status badges (past streams)

| Badge | Meaning |
|-------|---------|
| `No pulse` | Stream exists, no rollups collected |
| `Stats only` | Viewer/metadata only, no chat sync |
| `Chat synced` | Chat rollups present, partial Pulse |
| `Full pulse` | Full rollups + peaks + recap |

### 10.4 Single stream analytics — `/dashboard/c/{login}/s/{streamId}`

This is where the **full analytics** level lives. Maps directly to the analytics data model: one stream row + minute rollups + viewer source + emote maps + heatmap + game segments + sync status.

| ID | Requirement |
|----|-------------|
| SS1 | SHALL show a **full-stream heatmap** (composite + chat + 7TV + optional viewers/keywords lanes), source `GET /v1/analytics/streams/{streamID}/replay-heatmap`. |
| SS2 | SHALL show **top moments** + an **emote spike inspector** (top 3–5 emotes for the leading moment). |
| SS3 | SHALL show **viewer / chat / emote lanes** and summary metrics (`chat_per_min`, `emotes_per_min`, `seventv_per_min`, `reaction_score_0_100`, `viewer_momentum_5m`) from `GET /v1/analytics/streams/{streamID}/summary`. |
| SS4 | SHALL show **game / category segments** from `GET /v1/analytics/streams/{streamID}/games`. |
| SS5 | SHALL show **coverage + data-source badges** (§10.5) and an **Analytics quality** score (§10.6). |
| SS6 | SHALL show the **stream recap** (top 10 moments, top emotes, biggest chat spike, totals, peak chat/min) from `GET /v1/pulse/streams/{streamId}/recap`. |
| SS7 | SHALL show **saved moments** for this stream + Save from any moment; ranked moments support jump-to-VOD and (V2) "send to clip queue". |
| SS8 | SHALL show **sync / backfill status** with user-facing CTAs (§10.7); raw diagnostics only inside an **Advanced** drawer (§10.0.1). |
| SS9 | This page MAY request the full timeline (`window=full` / detail endpoints) because navigation here is an **explicit** user action — never auto-fetched on polling. |

### 10.5 Data-source badges (trust)

Expose the analytics `viewerSource` (and coverage source) as plain-language badges so users understand gaps:

| `viewerSource` | Badge |
|----------------|-------|
| `live` | Live samples |
| `tt` | TwitchTracker filled |
| `merged` | Merged coverage |
| `restored` | Restored from archive |
| `unknown` / none | Viewer data unavailable |

Coverage block (first-class on every stream page):

```text
Chat coverage: 82%       Viewer coverage: 64%
7TV / emote: Ready       VOD: Resolved
Sync health: Partial
```

### 10.6 Analytics quality score

A single trust indicator derived from existing summary fields — `data_coverage_pct`, `sync_health_state`, `viewerSource`, rollup count, `vodId` exists, chat message count.

```text
Analytics quality: Good
Chat: synced · Viewer: partial · Emotes: synced · VOD: resolved
```

| ID | Requirement |
|----|-------------|
| AQ1 | SHALL compute a coarse quality label (`Good` / `Partial` / `Limited` / `No data`) from the fields above; SHALL NOT invent a precise number it can't back. |
| AQ2 | SHALL break down per signal (chat / viewer / emotes / VOD) so users see *why* the score is what it is. |

### 10.7 Sync CTAs (user-facing, mapped to backend modes)

User-facing actions that map to internal analytics sync modes — never expose raw mode names:

| User action | Internal mapping |
|-------------|------------------|
| **Load missed moments** | Pulse backfill (`POST /v1/extension/pulse/channels/{login}/backfill`) |
| **Upgrade this stream** | full `POST /v1/analytics/streams/{streamID}/sync` (chat+emotes+rollups) |
| **Refresh viewer chart** | viewer/tracker prefetch (`POST .../prefetch-tracker`) |
| **Sync chat and emotes** | chat+emote sync mode |
| **Retry failed sync** | re-run sync on `failed` |

---

## 11. "Load missed moments" flow

The website and extension SHALL share **one concept and one backend job**. This flow is already implemented backend-side (`pulse_backfill.go`, `pulse_coverage.go`) and in the extension (`missedMoments.ts`); the website reuses the same endpoints and vocabulary.

### 11.1 Decision logic

```text
Coverage full (start ≤ 120s, no gaps)            → no CTA ("Full stream tracked")
Coverage partial/gaps + VOD available            → CTA: "Load missed moments"  (enqueue backfill)
Coverage partial + live + no VOD yet              → "Waiting for VOD" (disabled, honest)
Coverage partial + ended + no VOD                 → "Chat replay unavailable"
Data already exists for the range                 → load full-stream rollups (no new job)
```

### 11.2 Job progress states (exact, from backend)

Mirrors `PulseBackfill*` constants in `pulse_backfill.go`. The UI SHALL render a stepper and only show a percentage when `progress.percent > 0`; otherwise an indeterminate shimmer (no fake progress).

| Order | Status | UI label |
|-------|--------|----------|
| 1 | `queued` | Queued |
| 2 | `resolving_vod` | Resolving VOD |
| 3 | `waiting_for_vod` | Waiting for VOD |
| 4 | `ensuring_emotes` | Ensuring emotes |
| 5 | `fetching_chat` | Fetching chat |
| 6 | `tokenizing` | Tokenizing |
| 7 | `writing_rollups` | Writing rollups |
| 8 | `refreshing_moments` | Refreshing moments |
| ✓ | `done` | Done — moments refreshed |
| ✓ | `already_available` | Already loaded |
| ✗ | `failed` | Couldn't backfill |
| ✗ | `cancelled` | Cancelled |

### 11.3 Coverage states (from `pulse_coverage.go`)

| State | Meaning | CTA |
|-------|---------|-----|
| `full_stream_tracked` | start ≤ 120s, no gaps | none |
| `partial_tracking` | tracking began late | Load missed moments (if VOD) |
| `missing_ranges_detected` | gaps in coverage | Load missed moments |
| `waiting_for_vod` | live, archive not published | Waiting for VOD (disabled) |
| `vod_unavailable` | ended, no VOD chat | Chat replay unavailable |
| `backfill_running` | job in flight | progress stepper |
| `backfill_failed` | job failed | Retry |

### 11.4 Requirements

| ID | Requirement |
|----|-------------|
| LM1 | The website SHALL call `POST /v1/extension/pulse/channels/{login}/backfill` to enqueue and `GET /v1/extension/pulse/backfill/{jobId}` to poll. |
| LM2 | SHALL render the live stepper (§11.2) and poll until a terminal state. |
| LM3 | SHALL be **honest**: when `waiting_for_vod`/`vod_unavailable`, SHALL explain why and NOT offer a misleading "Load" button. |
| LM4 | On `done`, SHALL refresh coverage + moments and surface "Moments refreshed" (and full vs partial fill per `evaluateBackfillRefresh`). |
| LM5 | Backfill SHALL be **rate-limited per user/key** and bounded by a global concurrent-jobs cap (§18). |
| LM6 | One backfill job per stream SHALL be de-duplicated (a second request returns the existing job). |

### 11.5 Copy examples

```text
Partial coverage
Showing moments from 00:15:00 → live
Missing first 15 minutes
[Load missed moments]

Loading missed moments…  Fetching chat · 42%
Tokenizing · writing rollups · refreshing moments

Moments refreshed — earlier minutes are now in the graph.

Waiting for VOD
Twitch hasn't published the archive yet. Backfill unlocks after the VOD is available.
```

---

## 12. Account / auth requirements

Auth evolves across phases. The MVP uses the **beta key** that already gates the hosted endpoints (`pulse_hosted.go`), optionally bound to an anonymous device. V2 introduces real device auth + D1-backed user records.

### 12.1 Phased auth model

| Phase | Mechanism | Storage | Notes |
|-------|-----------|---------|-------|
| MVP | **Beta key** in `X-Streamclone-Beta-Key` header; optional device binding | Extension `chrome.storage.local`; site `localStorage`/cookie | Matches `PULSE_HOSTED_MODE` + `PULSE_BETA_KEYS`. No accounts. |
| V2 | **Device token** via `POST /v1/extension/auth/device` (opaque, Bearer) | D1 `devices` table | Scopes bookmarks/watchlists per device/user. |
| V3 | **Accounts** (email or Twitch OAuth) + tiers/billing | D1 `users` | OAuth only if "your followed channels" is needed. |

### 12.2 Requirements

| ID | Requirement |
|----|-------------|
| A1 | MVP SHALL accept a beta key via `/login` and store it; all dashboard API calls SHALL send `X-Streamclone-Beta-Key`. |
| A2 | SHALL handle 401 (`unauthorized` + `hint`) gracefully → prompt to re-enter/obtain a key. |
| A3 | SHALL NOT collect Twitch cookies or OAuth in MVP (privacy, §18). |
| A4 | V2 device tokens SHALL be sent as `Authorization: Bearer`, never cookies (keeps CORS `*`-compatible, design.md §3). |
| A5 | Account page SHALL show: active key/device, connected extension status, data export, and "forget my data". |
| A6 | Key/device revocation SHALL invalidate access on next request. |

### 12.3 Login page copy

```text
Connect StreamPulse
Enter your beta key to open the hosted dashboard.

[ PULSE-____-____-____ ]   [Connect]

Don't have a key? StreamPulse is in private beta — request access on GitHub/Discord.
```

---

## 13. Admin / operator requirements

**Route:** `/admin` (separate auth, never in public nav, never indexed). Grafana/Prometheus stay **private** (design.md §7.7); the admin console surfaces only operator-safe aggregates.

| ID | Requirement |
|----|-------------|
| OP1 | SHALL require operator auth distinct from beta keys (separate credential / IP allowlist / Cloudflare Access). |
| OP2 | SHALL show backend health: BFF cache hit ratio, poll RPS, p95 latency, IRC join count, tracked-channel count. |
| OP3 | SHALL show the **tracked-channel registry** with refcounts and allow eviction of idle channels. |
| OP4 | SHALL show **active backfill jobs** + global cap utilization; allow cancel. |
| OP5 | SHALL show **rate-limit / abuse** counters per key/IP and allow key revocation. |
| OP6 | SHALL surface capacity caps (max active channels, max concurrent backfills) and alert when near limit. |
| OP7 | SHALL NOT embed Grafana publicly; link to it behind operator auth only. |

### 13.1 Operator console blocks

```text
HEALTH      ● API up · v0.2.9 · p95 138ms · cache hit 94%
TRACKING    312 / 500 channels · 28 live · 4 evictable (idle > 30m)
BACKFILL    3 / 10 jobs running · 1 queued · 0 failed (1h)
ABUSE       top keys by RPS · 2 keys throttled · [revoke]
```

---

## 14. API / backend integration

All endpoints live on the Streamclone analytics service, fronted by Caddy and exposed at `https://api.streampulse.stream`. JSON, camelCase. Hosted endpoints are gated by the beta-key middleware when `PULSE_HOSTED_MODE=true` and `PULSE_BETA_KEYS` is set.

### 14.0 Three-layer endpoint model

The portal reads analytics through **layers**, by view depth:

| Layer | Use for | Endpoints |
|-------|---------|-----------|
| **Layer 1 — Extension BFF** (compact Pulse) | live status, coverage, recent rollups, top peaks, emote sync, recap summary — extension + small dashboard cards | `GET /v1/extension/pulse/channels/{login}` |
| **Layer 2 — Analytics detail** (deep stream views) | full heatmap, summary metrics, games, source/coverage, sync status | `GET /v1/analytics/channels/{login}/streams`, `GET /v1/analytics/streams/{streamID}`, `.../summary`, `.../replay-heatmap`, `.../games`, `.../sync/status` |
| **Layer 3 — Portal BFF** (curated, **later**) | collapse multi-call stitching once it hurts | `GET /v1/portal/channels/{login}`, `GET /v1/portal/streams/{streamId}`, `GET /v1/portal/dashboard` |

**MVP reuses Layer 1 + Layer 2; do not build Layer 3 until call-stitching is painful.** Layer 1 stays the default for polling (compact, cached); Layer 2 is fetched only on explicit navigation to a stream page (never on poll).

### 14.1 Existing / reused endpoints

| Method | Path | Purpose | Status |
|--------|------|---------|--------|
| GET | `/v1/extension/health` | Health + version | Implemented |
| GET | `/v1/extension/pulse/channels/{login}` | BFF Pulse payload (rollups, lanes, peaks, coverage, recap, emoteSync) | Implemented |
| POST | `/v1/extension/pulse/channels/{login}/backfill` | Enqueue "load missed moments" | Implemented |
| GET | `/v1/extension/pulse/backfill/{jobId}` | Backfill job status | Implemented |
| POST | `/v1/analytics/channels/{login}/watch` | Start shared tracking | Implemented (gate before public exposure, §18) |
| GET | `/v1/pulse/bookmarks` | List saved moments | Implemented (extension) |
| POST | `/v1/pulse/bookmarks` | Create | Implemented |
| PATCH | `/v1/pulse/bookmarks/{id}` | Edit label/notes | Implemented |
| DELETE | `/v1/pulse/bookmarks/{id}` | Delete | Implemented |
| GET | `/v1/pulse/streams/{streamId}/recap` | Stream recap | Implemented |
| GET | `/v1/analytics/channels/{login}/streams` | Channel stream list (+`/ranked`) | Implemented (Layer 2) |
| GET | `/v1/analytics/streams/{streamID}` | Stream detail | Implemented (Layer 2) |
| GET | `/v1/analytics/streams/{streamID}/summary` | Summary metrics (`data_coverage_pct`, `sync_health_state`, source) | Implemented (Layer 2) |
| GET | `/v1/analytics/streams/{streamID}/replay-heatmap` | Full-stream heatmap | Implemented (Layer 2) |
| GET | `/v1/analytics/streams/{streamID}/games` | Game / category segments | Implemented (Layer 2) |
| GET | `/v1/analytics/streams/{streamID}/sync/status` | Sync phase/status (sanitized for users) | Implemented (Layer 2) |
| POST | `/v1/analytics/streams/{streamID}/sync` | "Upgrade this stream" sync (gated) | Implemented (Layer 2) |

### 14.2 New endpoints for the website (proposed)

| Method | Path | Purpose | Phase |
|--------|------|---------|-------|
| GET | `/v1/public/stats` | Cached aggregate counters for landing stats band | MVP |
| GET | `/v1/public/status` | Public status summary for `/status` (no internals) | MVP |
| GET | `/v1/extension/me` | Current key/device context | V2 |
| POST | `/v1/extension/auth/device` | Mint device token | V2 |
| GET/POST/DELETE | `/v1/pulse/watchlist` | User watchlist CRUD (D1-backed) | V2 |
| GET | `/v1/pulse/clips` | Clip candidate queue | V2 |
| PATCH | `/v1/pulse/clips/{id}` | Update candidate status | V2 |
| GET | `/v1/pulse/moments/{id}` | Public shareable moment (read) | V2 |
| GET | `/v1/portal/channels/{login}` | Layer 3 curated channel BFF (collapse stitching) | V2 (only if needed) |
| GET | `/v1/portal/streams/{streamId}` | Layer 3 curated stream BFF | V2 (only if needed) |
| GET | `/v1/portal/dashboard` | Layer 3 curated dashboard aggregate | V2 (only if needed) |
| GET | `/v1/admin/*` | Operator metrics (behind operator auth) | MVP→V2 |

### 14.3 Integration requirements

| ID | Requirement |
|----|-------------|
| API1 | The website SHALL send `X-Streamclone-Beta-Key` on all gated calls when in hosted mode. |
| API2 | SHALL respect the BFF `X-Cache` and the 12s Redis TTL — do not poll faster than the cache window for live data. |
| API3 | SHALL handle `tracking:false` + warming (&lt; 5 rollups) as a "collecting" state, not empty. |
| API4 | `/v1/public/stats` SHALL be aggregate-only, cached ≥ 60s, and contain no PII. |
| API5 | SHALL treat coverage + backfill vocabulary as the single contract (§11) — no client-side re-derivation of moments. |
| API6 | The website's live data fetches SHALL NOT auto-request `window=full`; full timeline only on explicit user action (design.md fetch discipline). |
| API7 | Polling/cards SHALL use **Layer 1** (compact BFF); **Layer 2** analytics-detail endpoints SHALL be called only on explicit stream-page navigation. |
| API8 | The portal SHALL surface a **sanitized** sync status (user-facing phases); raw GQL/scraper/concurrency diagnostics SHALL be operator-only or behind an Advanced drawer (§10.0.1). |
| API9 | The portal SHALL NOT request or render archive/corpus/global-picker/admin-snapshot/raw-VOD-chat endpoints (operator-only). |

---

## 15. Cloudflare / streampulse-vps hosting architecture

### 15.1 Topology

```text
                     ┌──────────────────────────────────────────────┐
   Browser / Ext ───▶│  Cloudflare (DNS + proxy + Tunnel + WAF)      │
                     │   streampulse.stream      → website (static)  │
                     │   api.streampulse.stream  → cloudflared tunnel │
                     │   (rate limiting, TLS, caching, Access)       │
                     └───────────────┬──────────────────────────────┘
                                     │ cloudflared tunnel (no open ports)
                                     ▼
                     ┌──────────────────────────────────────────────┐
                     │  streampulse-vps — docker compose           │
                     │   Caddy :8090  (internal reverse proxy)       │
                     │   analytics API (chi)  ← BFF, bookmarks, recap│
                     │   analytics-workers (IRC, rollups, scoring,   │
                     │      emote sync, backfill workers)            │
                     │   Postgres (rollups, peaks, bookmarks, recap) │
                     │   Redis (BFF cache, tracking pool, rate buckets)│
                     │   emote service · metadata · video (as needed)│
                     │   pulse profile: Prometheus + Grafana (PRIVATE)│
                     └──────────────────────────────────────────────┘

   Optional (V2+):  Cloudflare D1 + Workers → users / devices / watchlists / saved moments
                    (NEVER rollups or raw chat)
```

### 15.2 Requirements

| ID | Requirement |
|----|-------------|
| H1 | `streampulse.stream` SHALL serve the static website (Cloudflare Pages or similar); `api.streampulse.stream` SHALL route via Cloudflare Tunnel to **streampulse-vps** Caddy `:8090`. |
| H2 | TLS SHALL terminate at Cloudflare; no public open ports on streampulse-vps (tunnel only). |
| H3 | Cloudflare SHALL provide WAF + per-IP rate limiting in front of `/v1/*`; the BFF/backfill add per-key/Redis token-bucket limits (§18). |
| H4 | D1/Workers are **optional, V2+**, for users/devices/watchlists/saved moments only — **never** rollups or raw chat. |
| H5 | The architecture SHALL stay **rollup-first**: raw chat is not stored for all streams by default (only transient during backfill tokenization). |
| H6 | Grafana/Prometheus SHALL be reachable only behind Cloudflare Access / operator auth, never public. |
| H7 | A single VPS is the MVP target; the read path (BFF, stateless + Redis-cached) SHALL be horizontally scalable behind Caddy when needed. |

### 15.3 Why this shape

- Tunnel removes the pre-cutover "IP-only HTTP" blocker (design.md §7.1) — Chrome's secure-context fetch needs HTTPS + a domain; Cloudflare provides both without exposing the VPS. Legacy `Caddyfile.bearhost` is rollback reference only.
- Redis BFF cache (12s TTL, already implemented) decouples viewer count from compute: 1,000 viewers of one channel = 1 compute per cache window.
- D1 is a good fit for tiny relational user data but a poor fit for high-write rollups — keep rollups in Postgres.

---

## 16. Data model suggestions

Backend tables already exist for the Pulse-critical data; the website mostly **reads** them and adds light user/account tables (D1 in V2).

### 16.1 Existing (Postgres — source of truth, do not duplicate)

| Table | Holds | Source |
|-------|-------|--------|
| `streams` | stream/VOD records, live/ended, vodId | analytics |
| minute rollups | per-minute chat/7TV/viewer counts, top emotes | analytics |
| heatmap peaks | scored moments, reasons, dominant signal | analytics |
| `pulse_bookmarks` | saved moments (id, userId?, login, streamId, vodId, offsetSeconds, label, notes, score, source) | design.md §5.1 |
| `pulse_stream_recap` | cached recap payload per stream | design.md §5.2 (optional) |

### 16.2 New (D1 / Workers — V2, user-scoped, tiny)

```sql
-- users (V3 when accounts land; V2 may key on device only)
CREATE TABLE users (
  id          TEXT PRIMARY KEY,         -- ULID
  email       TEXT UNIQUE,              -- nullable until accounts
  created_at  TEXT NOT NULL,
  tier        TEXT NOT NULL DEFAULT 'beta'  -- beta | free | pro (V3)
);

-- devices / beta keys
CREATE TABLE devices (
  id          TEXT PRIMARY KEY,         -- opaque device token id
  user_id     TEXT,                     -- nullable in beta
  beta_key    TEXT,                     -- bound beta key
  label       TEXT,
  created_at  TEXT NOT NULL,
  last_seen   TEXT,
  revoked_at  TEXT
);

-- watchlist (always-track preferences; tracking itself is shared in Redis pool)
CREATE TABLE watchlist (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  login       TEXT NOT NULL,
  always_track INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  UNIQUE(user_id, login)
);

-- clip candidate user-state (queue is computed; this stores per-user status/title)
CREATE TABLE clip_candidate_state (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  stream_id     TEXT NOT NULL,
  offset_seconds INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'new',  -- new|saved|dismissed|exported
  title         TEXT,
  start_seconds INTEGER,
  end_seconds   INTEGER,
  updated_at    TEXT NOT NULL
);
```

> Saved moments (`pulse_bookmarks`) MAY stay in Postgres (single source with the extension) and be mirrored/queried via the API rather than copied into D1. Decide during V2 (open question §22).

### 16.3 Redis (transient, not durable)

| Key | Purpose | TTL |
|-----|---------|-----|
| `ext:pulse:v2:{login}` | BFF payload cache | 12s |
| tracking pool registry + refcounts | shared "one session per channel" | until idle eviction |
| rate-limit token buckets per key/IP | abuse control | rolling window |
| backfill job state | progress polling | job lifetime |

---

## 17. UX states and empty / error states

Every data surface SHALL define loading, empty, partial, error, and unauthorized states. The guardrail is the extension's: **never fake data, never show zeroed charts as if real.**

### 17.1 Global state matrix

| Surface | Loading | Empty | Partial | Error | Unauthorized |
|---------|---------|-------|---------|-------|--------------|
| Dashboard home | Skeleton cards | "Add your first channel" CTA | — | "Can't reach StreamPulse" + Retry | Prompt for beta key |
| Channel page | Skeleton heatmap | "Not tracked yet — Start tracking" | Coverage chip + Load missed | Actionable error | 401 → key prompt |
| Moments | Skeleton rows | "No saved moments yet" | — | Retry | Key prompt |
| Past streams | Skeleton rows | "No past streams" | "Stats only / Chat synced" badges | Retry | Key prompt |
| Backfill | Stepper | — | step-by-step | "Couldn't backfill" + Retry | — |
| Stats band (landing) | Count-up placeholder | Hidden | — | Hidden | n/a |

### 17.2 Specific honesty states (reuse extension copy)

| State | Copy |
|-------|------|
| Warming (&lt; 5 rollups) | "Collecting moments… Pulse needs a few minutes of chat to rank the stream." |
| No peaks but supported | "Warming up — no ranked moments yet." (NOT estimated moments) |
| Backend unreachable | "Can't reach StreamPulse at &lt;url&gt;. Check your connection." [Retry] |
| Late tracking | "Showing moments from 00:15:00 → live · Missing first 15 minutes" |
| VOD pending | "Waiting for VOD — Twitch hasn't published the archive yet." |
| VOD unavailable | "Chat replay is unavailable for this stream." |
| Offline channel | "Offline. Showing the last tracked stream." |

### 17.3 Requirements

| ID | Requirement |
|----|-------------|
| UX1 | No surface SHALL render a zeroed chart as if it were real data. |
| UX2 | Empty states SHALL be action-oriented (a next step, not a dead end). |
| UX3 | All error states SHALL offer a retry or a settings/connection path. |
| UX4 | `prefers-reduced-motion` SHALL be respected (heatmap shimmer, count-ups, steppers). |
| UX5 | The live "current stream" SHALL never be presented as a past stream, and vice versa. |

---

## 18. Security / privacy requirements

| ID | Requirement |
|----|-------------|
| S1 | `/watch` (start tracking) SHALL NOT be exposed unauthenticated publicly — gate behind beta key / device auth before public exposure. |
| S2 | Hosted gated endpoints SHALL require a valid `X-Streamclone-Beta-Key` (or Bearer device token in V2); 401 with `hint` otherwise. |
| S3 | Rate limiting SHALL apply per **user/key and per IP**; `watch` and `backfill` SHALL have the strictest limits (they create load). |
| S4 | There SHALL be **one shared tracking session per channel**, never one per user (refcounted pool + idle eviction). |
| S5 | Active tracked channels and concurrent backfill jobs SHALL be capped globally and per user. |
| S6 | Grafana / Prometheus / admin SHALL be private only (Cloudflare Access / operator auth), never public, never indexed. |
| S7 | The product SHALL NOT collect Twitch cookies or user OAuth unless a feature explicitly requires it later (then opt-in + documented). |
| S8 | Storage SHALL be **rollup-first**: raw chat SHALL NOT be stored for all streams by default; backfill raw chat is transient (tokenize → rollups → discard). |
| S9 | `/v1/public/*` SHALL contain aggregate-only data (no PII, no per-user identifiers). |
| S10 | Beta keys/device tokens SHALL be revocable; revocation SHALL take effect on next request. |
| S11 | Secrets (beta keys, tokens, `.env`, `oauth-bundle.env`) SHALL never be committed or shipped in the static site bundle. |
| S12 | The site SHALL set a strict CSP, HSTS (via Cloudflare), and SHALL NOT inline beta keys in HTML. |

### 18.1 Privacy statement (user-facing copy)

```text
StreamPulse reads public Twitch chat and emote activity to rank stream moments.
We store minute-level summaries (rollups), not your messages or identity.
We don't read your Twitch login or cookies. Saved moments are private to you.
```

---

## 19. Performance requirements

| ID | Requirement | Target |
|----|-------------|--------|
| PERF1 | BFF cache-miss compute (p95) | &lt; 150ms (design.md §9) |
| PERF2 | Live polling interval | 30s default; never faster than the 12s BFF cache window |
| PERF3 | Landing page Lighthouse perf | ≥ 90 (static-first, no live data on critical path) |
| PERF4 | Dashboard first meaningful paint | &lt; 2s on broadband; skeletons immediately |
| PERF5 | Payload size (live window) | a few KB — last ~60 rollups, ≤ 10 peaks |
| PERF6 | Full timeline fetch | only on explicit user action (`window=full`), never on poll |
| PERF7 | Read path scalability | stateless BFF behind Caddy, N replicas; Redis cache absorbs viewer fan-out |
| PERF8 | Lanes precomputed server-side (0–100) | client does zero scoring math |

---

## 20. MVP vs V2 / V3 roadmap

### 20.1 Scope table

| Capability | MVP | V2 | V3 |
|-----------|:---:|:--:|:--:|
| Public landing page | ✅ | | |
| Extension setup / connection page | ✅ | | |
| Public backend status page | ✅ | | |
| Simple dashboard (home) | ✅ | | |
| Watchlist management | ✅ (basic) | ✅ (D1-backed) | |
| Saved moments list | ✅ | ✅ (sync) | |
| Past streams list + single stream analytics | ✅ | | |
| Load missed moments flow | ✅ | | |
| Beta-key / device / basic auth | ✅ | | |
| Link out to Streamclone analytics | ✅ | | |
| Full device auth | | ✅ | |
| D1-backed user settings / watchlists / saved moments | | ✅ | |
| Clip candidate queue | | ✅ | |
| Shareable moment pages (`/m/{id}`) | | ✅ | |
| Better stream recap | | ✅ | |
| Team / editor collaboration | | ✅ | |
| Public API docs | | ✅ | |
| Paid hosted Pulse | | | ✅ |
| Billing / tiers | | | ✅ |
| Streamer-owned dashboards | | | ✅ |
| Official Twitch Extension version | | | ✅ |
| Advanced AI clip scoring | | | ✅ |
| Multi-worker ingest scaling | | | ✅ |

**Explicitly out of MVP:** billing, public multi-tenant heavy backfill (abuse surface), accounts, OAuth.

### 20.2 Implementation phases

| Phase | Theme | Deliverables |
|-------|-------|--------------|
| **P0 — Infra** | Make hosted real | Cloudflare DNS/Tunnel → streampulse-vps, TLS at `api.streampulse.stream`, beta-key gating on, `/v1/public/stats` + `/v1/public/status`, rate limits, tracking-pool caps |
| **P1 — Marketing** | Landing + setup | `/`, `/setup`, `/docs`, `/status`, `/login`; hero, stats band, feature cards; install detection + health check |
| **P2 — Dashboard core** | Thin portal | `/dashboard`, `/dashboard/watchlist`, `/dashboard/c/{login}`, `/dashboard/streams`, `/dashboard/moments`; coverage + load-missed-moments reuse |
| **P3 — Admin** | Operability | `/admin` health/registry/jobs; alerts on caps |
| **P4 — V2** | Accounts + clips | device auth, D1 user data, clip queue, shareable moments, public API docs |
| **P5 — V3** | Monetize + scale | billing/tiers, streamer dashboards, Twitch Extension, AI scoring, multi-worker ingest |

---

## 21. Acceptance criteria

### 21.1 Landing (P1)

- [ ] Hero renders headline "Never miss the moment that mattered." with three working CTAs.
- [ ] Live product mockup of Twitch + Pulse overlay is visible above the fold.
- [ ] "How it works" shows the 4 steps in order.
- [ ] Stats band shows 5 counters from `/v1/public/stats`, animates on scroll, hides on failure.
- [ ] ≥ 6 feature cards render; resources section links Docs, Setup, Status, GitHub/roadmap, community.
- [ ] Lighthouse performance ≥ 90; responsive 360–1440px with no layout shift.

### 21.2 Connection (P1)

- [ ] Setup page shows backend URL with Copy-config producing valid `{backendUrl,betaKey,pollIntervalMs}`.
- [ ] Health check hits `/v1/extension/health` and shows ok/version/latency.
- [ ] 401 surfaces the `unauthorized` + key-prompt copy; `http://` non-localhost surfaces `mixed_content`.

### 21.3 Dashboard (P2)

- [ ] Live tracked channels appear as distinct current-stream cards; ended streams never appear in the live band.
- [ ] Watchlist shows correct status badges (LIVE/Offline/Warming/Synced/Partial) sourced from backend.
- [ ] Saved moments list supports search, jump (VOD deep link once resolved), edit, delete, export.
- [ ] Past streams list shows ended VODs only with correct sync badges; collapsible (3 + view all).
- [ ] Channel page shows coverage chip + "Load missed moments" only when partial and VOD available.

### 21.4 Load missed moments (P2)

- [ ] Enqueues via `POST .../backfill`, polls `GET .../backfill/{jobId}`, renders the exact step labels (§11.2).
- [ ] Percentage shows only when `progress.percent > 0`; otherwise indeterminate (no fake progress).
- [ ] `waiting_for_vod` / `vod_unavailable` show honest disabled copy, not a misleading Load button.
- [ ] On `done`, coverage + moments refresh; "Moments refreshed" appears.
- [ ] Backfill is rate-limited per key and de-duplicated per stream.

### 21.5 Security / privacy (P0)

- [ ] No unauthenticated public `/watch`; gated endpoints reject without a valid beta key (401 + hint).
- [ ] Rate limits enforced per key + IP; `watch`/`backfill` strictest.
- [ ] One shared tracking session per channel (verified via refcount registry).
- [ ] Grafana/admin unreachable publicly.
- [ ] `/v1/public/*` contains no PII; no raw chat stored for non-backfilled streams.

### 21.6 Admin (P3)

- [ ] `/admin` requires operator auth; shows health, tracked-channel registry + caps, active backfills.
- [ ] Operator can evict idle channels and revoke keys; alerts fire near caps.

---

## 22. Open questions

| # | Question | Owner | Default if unresolved |
|---|----------|-------|-----------------------|
| Q1 | Final public brand: **StreamPulse** vs "Streamclone Pulse" vs "Pulse for Twitch"? | Product | StreamPulse (web), Streamclone Pulse (extension) |
| Q2 | Website hosting: Cloudflare Pages vs same VPS behind Caddy? | Infra | Cloudflare Pages (static, cheap, fast) |
| Q3 | Do saved moments live in Postgres (single source with extension) or mirror into D1 in V2? | Backend | Keep in Postgres; query via API |
| Q4 | Beta key: pure shared keys (current) vs per-device minted tokens for MVP? | Backend | Shared beta keys for MVP (already built) |
| Q5 | `/v1/public/stats` cost — precomputed aggregate job vs live count? | Backend | Precomputed, cached ≥ 60s |
| Q6 | Should the website embed any live Twitch player, or only static mockups + deep links? | Product/Legal | Static mockups + deep links (avoid ToS/embed complexity) |
| Q7 | Clip export target: ReplayForge / Clip Studio handoff format? | Editor tooling | Defer to V2; export ranges as JSON |
| Q8 | Operator auth mechanism: Cloudflare Access vs separate admin credential? | Infra/Security | Cloudflare Access |
| Q9 | Per-user channel cap + global tracked-channel cap values? | Infra | Start conservative (e.g. 10/user, 500 global); tune via §13 |
| Q10 | Domain split: `app.streampulse.stream` for the dashboard vs path `/dashboard`? | Product | Path-based `/dashboard` for MVP |
| Q11 | Do we need a cookie/consent banner given no PII + aggregate analytics only? | Legal | Minimal/no banner if no tracking cookies; revisit with accounts |
| Q12 | Shareable moment pages (`/m/{id}`) — public by default or opt-in per moment? | Product/Privacy | Opt-in (saved moments are private by default) |

---

## Appendix A — Page → API → backend mapping (quick reference)

| Page | Primary calls | Backend |
|------|---------------|---------|
| `/` landing | `/v1/public/stats` | aggregate cache |
| `/setup`, `/dashboard/connection` | `/v1/extension/health` | health |
| `/status` | `/v1/public/status` | status summary |
| `/dashboard` | `/v1/extension/pulse/channels/{login}` (per tracked), `/v1/pulse/bookmarks` | BFF + bookmarks |
| `/dashboard/watchlist` | `/v1/pulse/watchlist` (V2), `POST /watch` (gated) | D1 + tracking pool |
| `/dashboard/c/{login}` | `/v1/extension/pulse/channels/{login}`, backfill endpoints | BFF + backfill |
| `/dashboard/c/{login}/s/{id}` | `/v1/extension/pulse/channels/{login}?window=full`, `/v1/pulse/streams/{id}/recap` | BFF + recap |
| `/dashboard/moments` | `/v1/pulse/bookmarks` CRUD | bookmarks |
| `/dashboard/clips` (V2) | `/v1/pulse/clips`, `PATCH /v1/pulse/clips/{id}` | clip queue |
| `/admin` | `/v1/admin/*` | operator metrics |

## Appendix B — Honesty rules carried from the extension

These cross-cut the whole product (do not regress them on the web):

1. Never invent estimated moments when backend `peaks` is empty — show **Warming/Collecting**.
2. "Most Reacted So Far" (live) ≠ "Stream Recap" (ended); never "Most Replayed".
3. Coverage is explicit; partial coverage states the missing range honestly.
4. "Load missed moments" only when a backfill can actually run (VOD available); otherwise explain why.
5. Backfill progress shows a real percent or an indeterminate state — never a fake progress bar.
6. Current live stream is a separate surface from past streams.
7. Optional lanes (viewers/keywords) are hidden when unavailable, never zero-filled.

---

*End of document.*

