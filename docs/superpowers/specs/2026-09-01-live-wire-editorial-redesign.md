# Live Wire Editorial Wire Redesign

**Date:** 2026-09-01

**Status:** Superseded on 2026-09-03 by the activity-rail contract

**Component:** `HubLiveWireFeed.tsx`
**Files affected:** `figma-analytics.css`, `HubLiveWireFeed.tsx`

---

> **Superseded:** Do not implement the violet tints, gradient strength bars,
> left-edge accents, three-card rail cap, or chart-annotation explorer described
> below. The canonical design is the flat, complete Live Wire activity rail in
> [`../../website-portal/live-wire-moment-system.md`](../../website-portal/live-wire-moment-system.md)
> and
> [`../../website-portal/analytics-command-center-layout.md`](../../website-portal/analytics-command-center-layout.md).

## Context

The Live Wire surface currently uses a minimal card treatment with thin borders, semi-transparent backgrounds, and tight spacing. While functional, it lacks the visual polish of the Newsroom sidecar and KPI tiles. The user requested a visual revitalization that preserves the dark/violet theme and truthful analytics semantics while making the cards feel more designed and professional.

After exploring three design directions (Editorial Wire, Pulse Radar, Minimal Signal), the **Editorial Wire** direction was selected. This spec records the card treatment that remains in use. The current product role, moment algorithm, category sorting, and chart interaction are canonical in [`../../website-portal/live-wire-moment-system.md`](../../website-portal/live-wire-moment-system.md).

---

## Design Direction: Editorial Wire

**Concept:** Bloomberg Terminal meets modern news design. Clean typography hierarchy, stronger accent rails along card edges, generous whitespace between cards. Monospace timestamps right-aligned. Emphasis on readability and professional calm.

**Visual language:** Left-border accent on each card (violet for emote breakouts, cyan for chat spikes, red for viewer spikes), larger body text, reduced decorative elements. Cards feel like news items, not notifications.

**What stays the same:**
- Dark/violet theme preserved
- Truthful analytics semantics (no fake zero-fill, no client-side scoring)
- Existing information architecture (card layout, evidence labels, emote display)
- 30-minute rolling window, 10-minute dedup, 12-card visible cap
- Chart-selection button behavior (only when moment resolves to a bucket)
- Layout modes: rail (vertical, max 3 cards) and lane (horizontal scroller)

---

## Card Anatomy

Each card contains the following sections, top to bottom:

### 1. Header Row

**Avatar image** (32px circle, Twitch profile image via `moment.profileImageUrl` or `profileImageByLogin`)

**Streamer name** (0.78rem, 600 weight)

**NEW badge** (when dedup fresh, yellow accent, 0.5rem)

**Game/category name** (0.6rem, uppercase, letter-spacing 0.04em, #94a3b8) — text label only, no icon (backend doesn't surface `boxArtUrl`)

**Current viewers** (0.6rem, monospace, #94a3b8)

**Stream title** (0.6rem, #64748b, truncated with ellipsis, single line) — joined from `hub.liveChannels` by login

**Time since detection** (0.6rem, monospace, #64748b, right-aligned)

**Stream offset** (0.5rem, monospace, #475569, below time, right-aligned)

### 2. Kind Label Row

Event kind label (color-coded):
- **Emote Breakout** — violet (#c084fc), background rgba(139, 92, 246, 0.15)
- **Chat Spike** — cyan (#22d3ee), background rgba(6, 182, 212, 0.12)
- **Viewer Spike** — red (#f87171), background rgba(239, 68, 68, 0.12)

Multiple labels possible (e.g., "Viewer Spike" + "Emote").

### 3. Metric Facts

**Primary metric** (0.82rem, monospace, 600 weight, #e2e8f0)

**Unit label** (/min, viewers, etc., 0.72rem, #64748b)

**Comparison** (▲ N% vs avg, 0.65rem, green #22c55e for positive, or "no baseline" fallback in #64748b italic)

**Confidence %** (0.52rem, monospace, #64748b, right-aligned)

Wrapped in a subtle background box matching the accent color at 6-8% opacity.

### 4. Evidence (Top 3 Emotes)

**Emote image** (20×20px, 7TV CDN image via `topEmotes[].imageUrl`)

**Emote name** (0.65rem, 500 weight, #cbd5e1)

**Emote use count** (0.52rem, monospace, #64748b)

Up to three emotes arranged in equal columns, with a thin vertical rule between adjacent items.

### 5. Footer

**Strength tier label** (0.52rem, uppercase, letter-spacing 0.05em, 700 weight, color-coded to tier):
- Strong — violet (#c084fc) or red (#f87171) depending on accent
- Notable — cyan (#22d3ee)
- Emerging — slate (#64748b)

**Compact gradient bar** (32px wide, 3px tall, gradient from accent color to lighter variant, border-radius 2px)

---

## Visual Treatment

### Card Container

- **Background:** Very subtle tint matching the accent color at 5-6% opacity
  - Emote Breakout: rgba(139, 92, 246, 0.06)
  - Chat Spike: rgba(6, 182, 212, 0.04)
  - Viewer Spike: rgba(239, 68, 68, 0.04)
  - Emerging/weak: rgba(148, 163, 184, 0.03)

- **Left border:** 3px solid, color-coded to event type
  - Emote Breakout: #8b5cf6 (violet)
  - Chat Spike: #06b6d4 (cyan)
  - Viewer Spike: #ef4444 (red)
  - Emerging/weak: #334155 (slate)

- **Border radius:** 0.5rem

- **Padding:** 0.7rem 0.8rem

- **Opacity:** 0.85 for emerging/weak cards (visual de-emphasis)

### Typography

- **Font family:** Inter, system-ui, sans-serif (body text)
- **Monospace:** IBM Plex Mono, ui-monospace, monospace (numbers, timestamps, counts)
- **Font sizes:** 0.52rem to 0.82rem (see anatomy above)
- **Font weights:** 400 (default), 500 (emote names), 600 (streamer names, metrics), 700 (badges, labels)

### Spacing

- **Gap between cards:** 0.75rem (rail layout)
- **Gap between sections within card:** 0.4rem to 0.45rem
- **Gap between inline elements:** 0.3rem to 0.5rem

### Interactive States

- **Cursor:** pointer (all cards clickable)
- **Hover:** No visual change (keep it calm)
- **Click:** Navigate to detailed analytics (see behavior below)

---

## Click Behavior

All cards are clickable. Clicking a card navigates to detailed analytics for that moment.

**If the moment resolves to a chart bucket:**
- Select the moment in the chart (same as current behavior)
- The inspector panel shows the moment details below the chart

**If the moment does NOT resolve to a chart bucket:**
- Navigate to the Newsroom story detail page (if a story exists for this moment)
- Or show a toast/message explaining the moment is too granular for chart selection

**Implementation:**
- Add `onClick` handler to card container
- Use existing `onSelectMoment` prop if moment resolves to bucket
- Otherwise, use React Router to navigate to `/analytics/newsroom/{storyId}` or show a message

---

## CSS Changes

### Files to Modify

1. **`figma-analytics.css`** (lines 3228-3897, Live Wire styles)
   - Update `.hub-live-wire__rail-card` with new background, border, padding
   - Add styles for stream title, emote images, metric facts box
   - Update typography to use monospace for numbers/timestamps
   - Add click cursor and hover states

2. **`analytics-surfaces.css`** (if new tokens needed)
   - No new tokens required — use existing `--sp-*` and `--fma-*` tokens

### Key CSS Rules

```css
/* Rail card container */
.hub-live-wire__rail-card {
  background: rgba(139, 92, 246, 0.06); /* or color-coded variant */
  border-left: 3px solid #8b5cf6; /* or color-coded variant */
  border-radius: 0.5rem;
  padding: 0.7rem 0.8rem;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.hub-live-wire__rail-card--emerging {
  opacity: 0.85;
  background: rgba(148, 163, 184, 0.03);
  border-left-color: #334155;
}

/* Header row */
.hub-live-wire__rail-header {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  margin-bottom: 0.45rem;
}

.hub-live-wire__rail-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  border: 1px solid rgba(139, 92, 246, 0.3);
}

.hub-live-wire__rail-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hub-live-wire__rail-identity {
  flex: 1;
  min-width: 0;
}

.hub-live-wire__rail-name {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--fma-text);
}

.hub-live-wire__rail-category {
  font-size: 0.6rem;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.hub-live-wire__rail-viewers {
  font-size: 0.6rem;
  color: #94a3b8;
  font-family: var(--fma-mono);
}

.hub-live-wire__rail-title {
  font-size: 0.6rem;
  color: #64748b;
  margin-top: 0.2rem;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hub-live-wire__rail-time {
  text-align: right;
  flex-shrink: 0;
}

.hub-live-wire__rail-time-ago {
  font-family: var(--fma-mono);
  font-size: 0.6rem;
  color: #64748b;
}

.hub-live-wire__rail-time-offset {
  font-size: 0.5rem;
  color: #475569;
  font-family: var(--fma-mono);
}

/* Kind label */
.hub-live-wire__rail-kind {
  font-size: 0.52rem;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  font-weight: 600;
  padding: 0.12rem 0.35rem;
  border-radius: 0.2rem;
}

.hub-live-wire__rail-kind--emote {
  color: #c084fc;
  background: rgba(139, 92, 246, 0.15);
}

.hub-live-wire__rail-kind--chat {
  color: #22d3ee;
  background: rgba(6, 182, 212, 0.12);
}

.hub-live-wire__rail-kind--viewer {
  color: #f87171;
  background: rgba(239, 68, 68, 0.12);
}

/* Metric facts */
.hub-live-wire__rail-metrics {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
  padding: 0.3rem 0.45rem;
  background: rgba(139, 92, 246, 0.08); /* or color-coded variant */
  border-radius: 0.25rem;
}

.hub-live-wire__rail-metric-value {
  font-family: var(--fma-mono);
  font-weight: 600;
  font-size: 0.82rem;
  color: var(--fma-text);
}

.hub-live-wire__rail-metric-unit {
  font-size: 0.72rem;
  color: #64748b;
}

.hub-live-wire__rail-metric-comparison {
  font-size: 0.65rem;
  color: #22c55e;
}

.hub-live-wire__rail-metric-comparison--no-baseline {
  color: #64748b;
  font-style: italic;
}

.hub-live-wire__rail-metric-confidence {
  font-size: 0.52rem;
  color: #64748b;
  font-family: var(--fma-mono);
  margin-left: auto;
}

/* Evidence (top 3 emotes) */
.hub-live-wire__rail-emotes {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
}

.hub-live-wire__rail-emote {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.hub-live-wire__rail-emote-image {
  width: 20px;
  height: 20px;
  border-radius: 2px;
  overflow: hidden;
  flex-shrink: 0;
  border: 1px solid rgba(148, 163, 184, 0.1);
}

.hub-live-wire__rail-emote-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hub-live-wire__rail-emote-name {
  font-size: 0.65rem;
  font-weight: 500;
  color: #cbd5e1;
}

.hub-live-wire__rail-emote-count {
  font-size: 0.52rem;
  color: #64748b;
  font-family: var(--fma-mono);
}

.hub-live-wire__rail-emote-divider {
  width: 1px;
  height: 18px;
  background: rgba(148, 163, 184, 0.12);
}

/* Footer (strength) */
.hub-live-wire__rail-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 0.4rem;
  border-top: 1px solid rgba(148, 163, 184, 0.08);
}

.hub-live-wire__rail-strength-label {
  font-size: 0.52rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 700;
}

.hub-live-wire__rail-strength-label--strong {
  color: #c084fc; /* or #f87171 for viewer spike */
}

.hub-live-wire__rail-strength-label--notable {
  color: #22d3ee;
}

.hub-live-wire__rail-strength-label--emerging {
  color: #64748b;
}

.hub-live-wire__rail-strength-bar {
  width: 32px;
  height: 3px;
  background: rgba(139, 92, 246, 0.2); /* or color-coded variant */
  border-radius: 2px;
  overflow: hidden;
}

.hub-live-wire__rail-strength-fill {
  height: 100%;
  background: linear-gradient(90deg, #8b5cf6, #c084fc); /* or color-coded variant */
  border-radius: 2px;
}
```

---

## Component Changes

### HubLiveWireFeed.tsx

**Props:** No changes to props interface.

**Rendering logic:**

1. **Card container:**
   - Add `onClick` handler that calls `onSelectMoment` if moment resolves to bucket, otherwise navigates to Newsroom story
   - Add `cursor: pointer` style
   - Apply color-coded background and border based on event kind

2. **Header row:**
   - Render avatar image from `moment.profileImageUrl` or `profileImageByLogin` map (fallback to initials circle if missing)
   - Render streamer name (`displayName(login, moment.displayName)`)
   - Render NEW badge if `isNew` is true
   - Render game/category name (uppercase) from `moment.category` or `categoryByLogin` map
   - Render current viewers from `moment.viewers`
   - Render stream title from `hub.liveChannels` lookup by login (truncated, single line)
   - Render time since detection (monospace)
   - Render stream offset (monospace, below time)

3. **Kind label row:**
   - Render event kind label(s) with color-coded styling
   - Support multiple labels (e.g., "Viewer Spike" + "Emote")

4. **Metric facts:**
   - Render primary metric (monospace, 600 weight)
   - Render unit label
   - Render comparison (▲ N% vs avg) or "no baseline" fallback
   - Render confidence % (monospace, right-aligned)
   - Wrap in background box matching accent color

5. **Evidence (top 3 emotes):**
   - Render up to 3 emotes as images from `topEmotes[].imageUrl`
   - Render emote name and use count
   - Separate with thin vertical rule

6. **Footer:**
   - Render strength tier label (color-coded)
   - Render compact gradient bar (width based on strength score)

**Data model audit (what's available vs what needs backend work):**

| Field | Available? | Source |
|---|---|---|
| Avatar image | ✅ Yes | `moment.profileImageUrl` / `profileImageByLogin` |
| Streamer name | ✅ Yes | `moment.displayName` / `displayName(login)` |
| Game/category name | ✅ Yes | `moment.category` / `categoryByLogin` |
| Viewers | ✅ Yes | `moment.viewers` (enriched by `enrichPulseMomentRows`) |
| Stream title | ⚠️ Needs join | `hub.liveChannels` by login — not on `FigmaMomentRow` directly |
| Top emotes (images) | ✅ Yes | `moment.topEmotes[].imageUrl` |
| Score / strength | ✅ Yes | `moment.score` |
| Comparison metrics | ✅ Yes | `moment.comparison.chat/emotes` |
| Confidence | ✅ Yes | `moment.confidence` |
| Clip candidate | ❌ Not derivable | Clip eligibility is a backend-owned contract; a display score threshold must not imply eligibility |
| Game icon (boxArtUrl) | ❌ Not available | Backend doesn't surface `boxArtUrl` in hub response |
| Game ID | ❌ Not available | Backend doesn't surface `gameId` in hub response |

**Key notes:**
- Stream title: add a `titleByLogin` map from `hub.liveChannels` (same pattern as `categoryByLogin` and `profileImageByLogin` already in the component)
- Game icon: **omit for now** — the backend doesn't provide `boxArtUrl` or `gameId`. The category text label alone is sufficient. If desired later, the backend would need to add `boxArtUrl` to `HubLiveChannel`.
- No other backend changes required.

---

## Lane Layout (Horizontal Scroller)

The lane layout uses the same card treatment but compressed horizontally for the horizontal scroller.

**Differences from rail:**
- Card width: 260px (fixed)
- Padding: 0.55rem 0.65rem
- Avatar: 22px circle
- Emote images: 18×18px
- Stream title: omitted (too narrow)
- Stream offset: omitted (too narrow)

**Same as rail:**
- Left border accent (3px)
- Color-coded background
- Typography hierarchy
- Click behavior

---

## Testing

**Visual verification:**
1. Open `/analytics` in Chrome DevTools MCP
2. Verify Live Wire rail renders with new card treatment
3. Verify emote images and joined stream titles render correctly
4. Verify click behavior navigates to detailed analytics
5. Verify color-coded accents match event types
6. Verify emerging cards have reduced opacity

**Edge cases:**
- Missing avatar image → fallback to initials circle
- Missing stream title → omit title line
- No baseline comparison → show "no baseline" in italic
- Multiple event kinds → show multiple labels
- Moment does not resolve to chart bucket → navigate to Newsroom story or show message

---

## Migration Notes

**Backward compatibility:**
- Existing card rendering logic is replaced entirely
- No breaking changes to props or data structures
- All existing data sources are reused

**Performance:**
- No new API calls required
- Image loading is already handled by the existing component
- No performance impact expected

**Accessibility:**
- Cards are clickable (keyboard accessible via `onClick` on div)
- Color is not the only differentiator (text labels also indicate event type)
- Monospace numbers improve readability

---

## Future Enhancements (Out of Scope)

- Animated entry transitions for new cards (currently instant)
- Glow effects for strong moments (rejected in favor of calm aesthetic)
- Expandable card to show more emotes or details
- Filter/sort controls in the rail header
- Clickable category label to filter by game

---

## Summary

The Editorial Wire redesign transforms Live Wire cards from minimal notification-style elements into professional, information-rich news items. The design preserves the dark/violet theme and truthful analytics semantics while adding joined stream titles, real emote images, and click-to-navigate behavior. The implementation requires CSS changes to `figma-analytics.css` and component updates to `HubLiveWireFeed.tsx`, with no backend changes needed.
