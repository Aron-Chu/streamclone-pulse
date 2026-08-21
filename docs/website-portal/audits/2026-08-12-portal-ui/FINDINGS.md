# Portal UI audit findings — 2026-08-12

**Baseline:** [`baseline.json`](./baseline.json) · HEAD `d57dfb9` · dirty worktree  
**Captures:** [`baseline-captures/`](./baseline-captures/) (Playwright matrix, 12/12 green)  
**Questions:** Landing = understand + reach install/analytics · Analytics = health + find/inspect moment

Ranking: severity → impact → evidence strength.

---

## Ranked findings

### F-01 — Fake Live ticker on empty/error hub (S0 Honesty)

| | |
|---|---|
| **Surface** | Landing |
| **Impact** | Always-on when hub empty or failing; invents traction behind a Live dot |
| **Evidence** | Capture `landing-phase-empty/honesty-probes.json`: `containsFallbackEmote/Mover/Count: true` (`widespeedlaugh 22.1K`, `caseoh_ 482/min`). Code: [`landingData.ts`](../../../../streampulse-web/src/ui/components/landing/landingData.ts) `FALLBACK_EMOTES` / `FALLBACK_MOVERS` returned when arrays empty. UI: [`EmoteTicker.tsx`](../../../../streampulse-web/src/ui/components/landing/EmoteTicker.tsx) blinking `.sl-dot` + label "Trending …" |
| **Done when** | Empty/error hub shows no fallback counts; ticker omitted or honest empty; no Live-dot on invented data. Same empty/error captures pass assertions. |

### F-02 — Additional landing fallback / demo honesty surface (S0 Honesty)

| | |
|---|---|
| **Surface** | Landing |
| **Impact** | State-specific: hub miss → demo models still look live |
| **Evidence** | Code: `FALLBACK_PREVIEW`, `FALLBACK_EXT`, `buildDemoLiveSignalModel()` in `landingData.ts` / `LiveSignalScrollGraph.tsx`. Related root cause to F-01. |
| **Done when** | Demo/fixture paths are labeled as demo **or** gated off when hub is empty/error; not presented as live. |

### F-03 — Mobile landing nav/CTA hidden (S1 Job blocked / discoverability)

| | |
|---|---|
| **Surface** | Landing |
| **Impact** | Mobile-only (≤960px menu, ≤560px Analytics CTA) — visitor cannot reach Analytics/Docs from header |
| **Evidence** | Capture honesty: `mobileMenuDisplay: "none"`, `mobileNavRightDisplay: "none"`. CSS [`landing.css`](../../../../streampulse-web/src/ui/components/landing/landing.css) `@media (max-width: 960px) { .sl-menu { display: none } }` and `@media (max-width: 560px) { .sl-nav__right { display: none } }`. **Not** WCAG 2.4.1/2.4.3; closer to discoverability / Multiple Ways. |
| **Done when** | ≤390px capture shows reachable Analytics + Docs (drawer or visible links); keyboard open/close/Escape; focus return. |

### F-04 — Landing skip link missing (S2 Class / 2.4.1 technique gap)

| | |
|---|---|
| **Surface** | Landing |
| **Impact** | Keyboard users hit sticky header + long marketing before `#demo` |
| **Evidence** | Code: no `.sc-skip` in `Landing.tsx`. Capture probe `hasSkipLink: true` is a **false positive** (matched hero `a[href="#demo"]` scroll cue). Analytics already has skip in `AnalyticsTopNav`. |
| **Done when** | Visible-on-focus skip link to main/demo; probe checks `.sc-skip` only. |

### F-05 — Hub on landing critical path (S1 / static-first conflict)

| | |
|---|---|
| **Surface** | Landing |
| **Impact** | Always-on: `usePublicHubData({ pollMs: 45_000 })` on `/` |
| **Evidence** | Capture honesty `hubHitsSample` includes `GET /v1/public/hub?activityWindow=24h`. Design goal: static-first, no live API on first paint ([design.md](../design.md)). First-paint meta can still show empty request list if screenshot wins the race — network still starts immediately. |
| **Done when** | First paint does not require hub; optional live enhancement is labeled (“Live hub · updated …”) and hide-on-error. |

### F-06 — Analytics KPI/chart loading uses ellipsis, not layout skeleton (S3→S1 state)

| | |
|---|---|
| **Surface** | Analytics |
| **Impact** | Loading-only comprehension |
| **Evidence** | Code: `KpiCard` renders `…` when loading. Shared `Skeleton`/`EmptyState` exist in `src/ui/primitives` and hub `primitives.tsx` but landing ticker and several analytics panels do not use them consistently. |
| **Done when** | Loading KPIs/chart/moments reserve layout shape; zero-live rail does not silently unmount without empty copy. |

### F-07 — Analytics status banner stack (S3 Polish)

| | |
|---|---|
| **Surface** | Analytics |
| **Impact** | Density / health comprehension |
| **Evidence** | `AnalyticsLandingPage` mounts cache banner + `HubDataHealthBanner` + `HubBackendSourceBanner` above command header. |
| **Done when** | In-place consolidation prototype captured; no new primitive required unless prototype proves need. |

### F-08 — Competing motion signatures on landing (S3 Polish)

| | |
|---|---|
| **Surface** | Landing |
| **Impact** | Attention split; reduced-motion already kills rain/chat |
| **Evidence** | Capture `motionSignatures`: emoteRain, chatBackdrop, tickers, extensionTour, signalGraph all true. |
| **Done when** | Gate may defer; not blocking honesty/nav. |

---

## Primitives consistency report

| Primitive | Shared kit | Hub-local duplicate | Landing usage | Analytics usage |
|---|---|---|---|---|
| `Skeleton` | `src/ui/primitives` | `hub/primitives.tsx` | Unused | Partial (`LiveChannelsMatrix`, `HubTopEmotesTable`); KPIs use `…` |
| `EmptyState` | shared | hub-local | Unused for ticker | Hub chart/rail use hub-local |
| `Segmented` | shared | — | Unused | Range control is custom |
| `StatCard` | shared | hub-local | Unused | Command header uses `KpiCard` |
| `Button` / `buttonClass` | shared | — | Used | — |

**Conclusion:** shortage is not the primary diagnosis. Prefer reuse / thin adapters over new kit inventory.

---

## Parking lot (no change this pass)

- Shared `MobileNav` abstraction across landing + analytics
- `ElapsedLoader` / `StatusRow` / `TraceList` as new primitives
- Section reorder, Geist replacement, `Figma*` renames
- Restoring PRD `/setup` `/login` `/dashboard` CTAs without product gate

---

## Post-gate / re-audit status

See [`PRODUCT-GATE.md`](./PRODUCT-GATE.md) and [`REAUDIT.md`](./REAUDIT.md).

| ID | Status after minimal work |
|---|---|
| F-01 | **Closed** — builders return `[]`; empty/error probes false |
| F-02 | Partial / deferred (demo fixtures) per gate |
| F-03 | **Closed** — `LandingMobileNav` |
| F-04 | **Closed** — `.sc-skip` |
| F-05 | Honesty closed; hub poll remains (documented) |
| F-06 | Partial closed — ticker Skeleton/EmptyState + live-rail empty |
| F-07 | Prototype shipped — `hub-status-strip` wrapper |
| F-08 | Deferred |
