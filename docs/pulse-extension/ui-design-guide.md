# StreamPulse — UI design guide (extension + portal)

Practical, repository-specific guide for Pulse UI work. Prefer this document plus the
implementation modules below over stale Figma hex dumps when they disagree.

**Related:** [`figma-handoff.md`](./figma-handoff.md), [`figma/`](./figma/),
[`../website-portal/analytics-command-center-layout.md`](../website-portal/analytics-command-center-layout.md),
[`reliability-public-release-plan.md`](./reliability-public-release-plan.md).

> **Note:** `src/ui/surfaceTheme.ts` and the smart-theme / restrained-motion design
> specs are **not** present on authoritative baseline `7024649f`. Until those land,
> use `theme.ts`, `overlayTheme.ts`, `chartTheme.ts`, portal `--sp-surface-*`, and
> this guide. When those modules/specs appear, they become part of the SoT hierarchy
> below — they do not invent parallel token systems.

---

## 1. Source-of-truth hierarchy

1. **Runtime implementation tokens** (win on conflict):
   - Extension: `src/ui/theme.ts`, `src/ui/overlayTheme.ts`, `src/ui/chartTheme.ts`
   - Portal analytics: `streampulse-web/src/ui/themes/analytics-surfaces.css` and theme CSS under `analytics-themes/`
2. **Product layout contracts:** portal Command Center layout doc; extension host/layout code under `src/content/`
3. **Figma PNG + handoff table:** visual composition and spacing intent
4. **Future design specs** (when present): smart-theme / restrained-motion under `docs/superpowers/specs/`

**Rule:** Current implementation tokens supersede stale Figma exports when they differ.
Do not reintroduce Figma-only values that the code has already moved away from
(example: Figma `text.muted` `#6b7280` vs implementation `theme.textMuted` `#8b8ba0`).

---

## 2. Brand and product naming

- User-facing product name: **StreamPulse**
- Peak mark for icons / brand marks where brand assets apply
- Do not ship “Streamclone Pulse” in store-facing or public marketing chrome
- Brand in tools is restrained: Peak / accent, not oversized marketing display type inside panels

---

## 3. Extension surface roles (`theme.ts`)

Canonical dark palette (current implementation):

| Role | Token | Value |
|------|-------|-------|
| Canvas | `bgCanvas` | `#111117` |
| Page / host mock | `bg` | `#18181b` |
| Panel | `panel` | `#262633` |
| Elevated panel | `panelElevated` | `#2a2440` |
| Glass panel | `panelGlass` | `rgba(17, 17, 23, 0.92)` |
| Text primary | `textPrimary` | `#fafafc` |
| Text secondary | `textSecondary` | `#a1a1b2` |
| Text muted | `textMuted` | `#8b8ba0` |
| Border | `border` | `#3f3f50` |
| Live | `live` / `liveSoft` | `#22c55e` / `#86efac` |
| Rank / hot | `rank1` | `#f97316` |
| Error / warning | `error` / `warning` | `#f87171` / `#fdba74` |
| Radii | `radiusPanel` / `radiusButton` / `radiusPill` | `14` / `9` / `13` |
| Font | `font` | `Inter, ui-sans-serif, system-ui, sans-serif` |

Accent consumers use `var(--pulse-*, <Aurora fallback>)` so first paint matches Aurora
even before `applyAccentTheme` runs.

There is no separate light-mode palette in extension `theme.ts` today. If a light scheme
is added later, it must be an explicit token set — do not invent ad-hoc light greys.

---

## 4. Accent themes (`overlayTheme.ts`)

User-selectable accents written to `document.documentElement` as `--pulse-*` so they
cascade into Shadow DOM hosts:

| Pref | Accent | Strong | Light | Soft | On-accent |
|------|--------|--------|-------|------|-----------|
| Aurora (default) | `#8b5cf6` | `#7c3aed` | `#a78bfa` | `#c4b5fd` | `#ffffff` |
| Volt | `#f97316` | `#ea580c` | `#fb923c` | `#fdba74` | `#04181d` |
| Emerald | `#34d399` | `#10b981` | `#6ee7b7` | `#a7f3d0` | `#04181d` |
| Azure | `#22d3ee` | `#0fb6d6` | `#67e8f9` | `#a5f0fb` | `#04181d` |

All four are user-selectable. `ACCENT_THEME_OPTIONS` derives each picker swatch
from `ACCENT_PALETTES[value].accent`, so a swatch cannot drift from the accent it
represents. Adding a palette entry without a row here fails
`tests/accentThemeVariables.test.ts`.

`accentLight` backs `--pulse-accent-light`, which focus rings and hover borders
in both settings surfaces consume. Every `var(--pulse-*)` reference must resolve
to a variable the runtime actually writes; an undefined one silently renders the
Aurora fallback under every accent, which is how focus rings previously stayed
purple on Volt, Azure and Emerald.

### WCAG Contrast Verification

Computed relative luminance and contrast ratios against foreground text:

| Theme | Background / Fill | Foreground | Contrast Ratio | WCAG Compliance | Notes |
|-------|-------------------|------------|----------------|-----------------|-------|
| **Volt** | `#ea580c` (Strong) | `#04181d` (Dark ink) | **5.11:1** | **Pass (AA)** | Default on-accent |
| **Volt** | `#f97316` (Accent) | `#04181d` (Dark ink) | **6.49:1** | **Pass (AA)** | High-contrast pairing |
| **Volt** | `#ea580c` (Strong) | `#ffffff` (White) | **3.56:1** | **Fail (< 4.5:1)** | White on Volt strong is prohibited |
| **Azure** | `#0fb6d6` (Strong) | `#04181d` (Dark ink) | **7.53:1** | **Pass (AAA)** | Default on-accent |
| **Azure** | `#22d3ee` (Accent) | `#04181d` (Dark ink) | **10.07:1** | **Pass (AAA)** | Very high contrast |
| **Aurora** | `#7c3aed` (Strong) | `#ffffff` (White) | **5.70:1** | **Pass (AA)** | Default on-accent |
| **Aurora** | `#8b5cf6` (Accent) | `#ffffff` (White) | **4.23:1** | Border / Large only | Filled text buttons use `#7c3aed` Strong |
| **Emerald** | `#10b981` (Strong) | `#04181d` (Dark ink) | **7.18:1** | **Pass (AAA)** | Default on-accent |
| **Emerald** | `#34d399` (Accent) | `#04181d` (Dark ink) | **9.47:1** | **Pass (AAA)** | Very high contrast |
| **Emerald** | `#10b981` (Strong) | `#ffffff` (White) | **2.54:1** | **Fail (< 4.5:1)** | White on Emerald strong is prohibited |

Use accents for interactive chrome (buttons, selection rings, pin bands). Do **not**
recolor semantic chart lanes to follow accent (see charts). Buttons, badges, and
interactive pills with solid fills use `accentStrong` paired with `onAccent` (`#04181d` for
Volt and Azure, `#ffffff` for Aurora) ensuring all interactive text exceeds the WCAG AA
4.5:1 threshold.

---

## 5. Portal surface roles (`--sp-surface-*`)

Under `streampulse-web/src/ui/components/analytics`:

| Token | Use |
|-------|-----|
| `--sp-surface-1` | Top-level cards / sections |
| `--sp-surface-2` | Nested containers |
| `--sp-surface-3` | Rows / chips at rest |
| `--sp-surface-3-hover` | Hover |
| `--sp-surface-active` | Selected / active |
| `--sp-surface-inset` | Inset wells |

Do not introduce new `rgba(255,255,255,…)` card backgrounds on analytics surfaces.
Prefer tokens from `analytics-surfaces.css`.

---

## 6. Semantic color usage

- **Live / tracking:** green (`live`) — status only, not decorative fill walls
- **Hot / rank #1:** orange (`rank1`) — moments and ranking callouts
- **Error / warning:** red / amber — failures, degraded coverage, retryable faults
- **Accent:** primary actions and selection — not every border
- **Muted text:** meta, timestamps, section caps — never critical values

---

## 7. Typography and numeric data

- Family: Inter stack as in `theme.ts` / Figma handoff
- Panel titles ~14–16 semi-bold; section caps ~9 uppercase; body ~12

### Per-surface minimum sizes

The floor differs by surface **on purpose**, because the constraints differ. Record
the reason rather than treating either number as drift:

| Surface | Floor | Why |
|---------|-------|-----|
| Twitch overlay (content) | 9px, uppercase caps and chart axis labels only | Lives in a ~320px rail beside chat; body text stays ~12 |
| Popup | 11px | Small but freestanding, no host competing for width |
| Full-page settings / options | 12px | A real top-level page has no width excuse |
| Portal | 12px, enforced by test | Same reasoning as the settings page |

Nothing may go below its surface floor. **8px is below every floor** and is not
permitted anywhere — including chart readouts, game-card names and emote badges,
which previously used it. When a label will not fit at the floor, truncate,
abbreviate or drop it; do not shrink past legibility.
- Numeric Pulse values: tabular / monospace-friendly rendering where charts and KPIs
  already do so; keep units honest (msg/min, viewers, offsets)
- Do not use oversized marketing display type inside overlay, popup, or options tools

---

## 8. Spacing and density

- Overlay expanded width target ~320–380px beside Twitch chat
- Prefer compact rows and shared gutters over card-in-card padding stacks
- One visual job per section; avoid duplicate live rails / duplicate KPI strips
  (portal layout contract)

---

## 9. Borders, dividers, shadows, radii

- Default border: `theme.border` / accent border via `--pulse-accent-border`
- Prefer 1px inset borders over heavy drop shadows
- Panel radius 14; buttons 9; pills 13
- Soft elevation only on intentional hover/focus — not on every rectangle

---

## 10. Icons and controls

- Prefer existing icon components / Peak mark over inventing text buttons for common
  actions (settings gear, expand/collapse)
- CHAT/PULSE tab chrome must remain recognizable and lightweight (`OverlayTabsShell`
  for `sidebarPart="tabs"`)
- Do not replace standard icons with prose-only controls when an icon already exists

---

## 11. Charts (`chartTheme.ts`)

### Lanes (fixed — do not follow accent)

| Lane | Color |
|------|-------|
| Chat bars | `#a78bfa` |
| Emote bars | `#34d399` |
| Chat trend | `#d4d4d8` |
| Viewer series | `#22d3ee` |
| Spike | `#fb7185` |

Interaction chrome (pin band, crosshair, marker rings) **does** follow `--pulse-*`.

### Sticky bucket selection

- A committed minute/moment stays selected while users change chart range, zoom/pan,
  expand/reset the chart, toggle spike or emote overlays, use chart dropdowns, or
  interact with Games Played.
- “Clear plotted emotes” clears only emote lines. It must never share the committed
  bucket-clear callback.
- Close, Escape, an unrelated outside click, or a real stream/channel/VOD identity
  change clears the selection. Selecting another minute or moment replaces it.
- When navigation moves the committed bucket off-screen, keep its full-rail marker
  and show “Return to selected”; returning recenters the viewport without seeking
  Twitch playback.

### Axes, tooltips, legends

- Keep legends aligned to fixed lane colors
- Tooltips: concise metric + time; no raw chat
- Grid lines stay low-contrast (`CHART_INTERACTION.gridLine`)

### Game markers

- Vertical dashed dividers only — **no** on-plot game-name lettering
- Names stay in Games played list / strip

### GamesPlayedStrip

- Live: range-aware to chart window; expand to show all
- Stream Recap / VOD / offline: full always-expanded list
- Do not restore rotated chart labels or the top horizontal game band unless explicitly asked

### Full-window behavior

- Recurring live polling uses **recent** windows
- **Full** history may load once automatically after stable activation identity; retry remains an explicit action. Recurring polling stays recent and gaps remain visible (R14)
- Coverage and backfill UI must match backend state — no fake progress

---

## 12. Motion and reduced motion

`theme.ts` ships restrained enter / shimmer / live-ping animations and a global
`prefers-reduced-motion: reduce` block that collapses durations.

Rules:

- Motion communicates hierarchy (enter, selection, live pulse) — not decoration
- No ornamental gradients/orbs as the primary visual idea
- When restrained-motion / smart-theme specs land, follow them without forking a second
  animation system

---

## 13. Twitch host constraints

- Content scripts mount into Twitch layout; preserve player and chat
- Two hosts: tabs shell vs panel host — one of each; avoid duplicate overlays and
  orphaned pollers
- Shadow DOM isolation: do not leak unscoped CSS that breaks Twitch
- Sidebar/header/body constraints live in `src/content/twitch*.ts` — measure, don’t assume

---

## 14. Surface distinctions

| Surface | Role | Notes |
|---------|------|-------|
| Overlay (content) | Primary product UI on Twitch | Dense, Shadow DOM, accent themes |
| Popup | Quick status / links | Minimal; no dashboard clone |
| Options | Preferences | Clear labels; no marketing hero |
| Portal `/analytics` | Command Center | `--sp-surface-*`; layout SoT doc |
| Public pages | Privacy / Support / Docs | Document chrome; honest copy |

Do not copy portal dashboard density into the MV3 popup.

---

## 15. Responsive and constrained width

- Overlay must remain usable at Twitch sidebar widths
- Portal analytics must survive narrow desktop widths without nested horizontal scroll traps
- Prefer collapsing secondary detail over shrinking type below readable sizes

---

## 16. Accessibility

- Keyboard: focusable controls for tabs, range, settings, moment rows
- Focus: visible accent rings; do not remove outlines without a replacement
- Contrast: primary text on panel backgrounds; muted text only for secondary meta
- Hit targets: adequate for chat-adjacent clicking
- Status text must remain readable without color alone (coverage / live / error)

---

## 17. Loading, empty, stale, offline, partial, error, retry

| State | Guidance |
|-------|----------|
| Loading | Skeleton / shimmer using panel tokens — not blank white |
| Empty | Honest empty copy; never invent zeros as “quiet chat” |
| Stale | Say stale / cached when backend says so |
| Offline / unreachable | Actionable “can’t reach StreamPulse” + retry / settings |
| Partial coverage | Show collecting / partial — never fake progress bars |
| Error | Short cause + retry; no secrets in copy |
| Retry | Explicit control; preserve last good frame when possible |

---

## 18. Content and error-copy conventions

- Use StreamPulse, not internal repo names, in user copy
- Never ask users for cookies, authorization headers, raw chat exports, or secrets
- Support/privacy copy must match **current** behavior (see Privacy / Support pages)
- Planned systems (Turnstile form, extension diagnostics consent, product analytics) stay
  out of user instructions until implemented

---

## 19. Screenshots and visual regression

- CWS screenshots: exact 1280×800, full bleed, from the candidate `dist/`
- Prefer mocked fixture captures for RC validation; live Twitch captures are a separate
  audited operator workflow
- Visual regressions: compare against committed fixtures / prior RC set — do not “fix”
  by regenerating store ZIPs casually

---

## 20. Prohibited generic patterns

- **The same control implemented twice with divergent markup, class names or
  copy.** The overlay settings tab and the full-page settings workspace each had
  their own accent, density and placement pickers, which is why the two surfaces
  read as different products — the same placement value was even labelled "Right"
  in one and "Right dock" in the other. Share one component with a density
  variant (`src/ui/ChoicePicker.tsx`) and one option list
  (`src/ui/preferenceOptions.ts`, `ACCENT_THEME_OPTIONS`)
- Inline `style={{…}}` for values a token or stylesheet already owns, or for a
  class that exists in no stylesheet
- Decorative card stacks and nested cards that add no interaction
- Oversized marketing type inside tools
- Ornamental gradients / orbs as the main visual idea
- Text controls where standard icons already exist
- Cyan/teal on-plot peak pins, circular bucket-cue nodes, or channel live pips that the
  portal layout contract has retired
- New analytics `rgba(255,255,255,…)` card backgrounds bypassing `--sp-surface-*`
- Presenting planned consent / support / telemetry UX as if it already ships

---

## 21. Consent and Help (planned vs current)

**Current**

- No extension diagnostics SDK, no product-analytics SDK, no hosted Turnstile support form
- Help / Support should open the hosted Support page; contact uses verified
  `privacy@streampulse.stream`

**Planned (R15–R16)**

- Separate versioned default-off diagnostics and analytics consents
- Hosted support form with Turnstile on the website (never remote challenge scripts in MV3)

Do not implement those UX flows in Phase 0 documentation as if they are live.
