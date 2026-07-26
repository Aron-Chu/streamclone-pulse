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

| Pref | Accent | Strong | Soft | On-accent |
|------|--------|--------|------|-----------|
| Aurora (default) | `#8b5cf6` | `#7c3aed` | `#c4b5fd` | `#ffffff` |
| Volt | `#53fc18` | `#43e80f` | `#b6ff8f` | `#07140a` |
| Azure | `#22d3ee` | `#0fb6d6` | `#a5f0fb` | `#04181d` |

Use accents for interactive chrome (buttons, selection rings, pin bands). Do **not**
recolor semantic chart lanes to follow accent (see charts).

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
- **Full** history is an explicit user action (planned chart migration v2 / R14)
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
