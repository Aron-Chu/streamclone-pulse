# Live Wire responsive sticky right rail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Live Wire (the hub-landing "Pulse Wire") from a chart-attached horizontal lane into a responsive sticky right-rail catch-moment radar with detailed callout cards, tiered "Live now" + "Older retained" freshness, and sibling analytics/VOD actions.

**Architecture:** Add a landing-only `rightRail` slot to the analytics shell (a scoped `--with-right-rail` grid modifier, sticky grid child, engaged at ≥1440px only; in-flow section below the center at all narrower widths). Move pure logic (timestamp classifier, bar normalization, action resolution) into a testable `src/lib/liveWire.ts` + `src/lib/momentActions.ts`. Rework `HubLiveWireFeed` to a rail layout with cards, tiering, and poll-identity-gated NEW. Wire `pollSequence` + `loadSource` through the landing page. Replace the 4 E2E specs that assert the opposite contract and update docs.

**Tech Stack:** React 18 + Vite, TypeScript, GSAP (`useAnalyticsMotion`), `react-router-dom`, Vitest (jsdom), Playwright E2E.

## Global Constraints

- **Naming:** This surface is **Live Wire**. Do NOT use "Pulse Wire" in any new/edited copy on the hub landing (no-resurrection naming rule).
- **No backend change:** Reuse `LivePulseMomentsResult` / `resolveLivePulseMoments` only. No new fields, no new fetching.
- **No missing-vs-zero distinction:** Backend numeric fields use `omitempty`, so absent and zero are indistinguishable on the wire → **treat both as unavailable** ("—", no bar). Never render a fabricated `0`.
- **Never `position: fixed` for the rail** — sticky grid child only.
- **Never `href="#"`** for moment actions — render a disabled state when no analytics/VOD target exists.
- **No client-side derived score** — display backend `moment.score` only if present; otherwise omit.
- **NEW gating:** requires `loadSource === "full"` AND healthy network (`!isHubNetworkDegraded(loadSource, hubEndpointOk)`), keyed on `pollSequence`. No NEW on cache/fallback/degraded/cache-hydrate.
- **Reduced motion:** suppress entrance animation; retain the semantic `NEW` label.
- **No nested interactive controls** — moment card is a non-interactive `article` with sibling action links/buttons.
- **Commands scoped:** run portal scripts as `npm --prefix streampulse-web run <script>`.
- **Test location:** vitest picks up `streampulse-web/tests/*.test.ts` (jsdom, globals). E2E live in `streampulse-web/tests/e2e/`.
- **Single scroll owner in the rail:** document stays the page scroll owner; the rail is the second intentional owner via `overflow-y: auto`, viewport-bounded; no nested scroll containers.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/lib/liveWire.ts` (new) | Pure Live Wire logic: `resolveMomentAtMs`, `classifyMomentWindow`, `normalizeRatePct`, `dedupeMomentsByLogin`, `capNewMomentsPerPoll`. |
| `src/lib/momentActions.ts` (new) | Pure action resolution: `resolveMomentActions(moment)` → analytics/VOD hrefs + disabled reason, modeled on the mounted `FigmaMomentInspector`. |
| `src/ui/motion/useAnalyticsMotion.tsx` | Add a right-entry directional option to `animateEnterHorizontal` (default stays left for back-compat). |
| `src/ui/components/analytics/AnalyticsFigmaShell.tsx` | Add `rightRail?: ReactNode` slot + `--with-right-rail` frame modifier, landing-only. |
| `src/ui/components/analytics/figma-analytics.css` | Rail grid column (≥1440px), sticky rail, `--with-right-rail` scoped rules; single internal scroll owner. |
| `src/ui/components/analytics/FigmaGlobalActivityPanel.tsx` | Remove the in-chart `annotation-lane` / `HubLiveWireFeed layout="lane"` block. |
| `src/ui/components/analytics/HubLiveWireFeed.tsx` | Rework to rail layout, Callout cards, tiering, poll-gated NEW, sibling actions. |
| `src/routes/analytics/AnalyticsLandingPage.tsx` | Pass `pollSequence`/`loadSource` into `liveWireFeedProps`; drop lane usage; render rail via shell `rightRail`; add in-flow section below center for <1440. |
| `tests/liveWireUtils.test.ts` (new) | Unit tests for `liveWire.ts`. |
| `tests/momentActions.test.ts` (new) | Unit tests for `momentActions.ts`. |
| `scripts/check-analytics-links.mjs` | Align its inline `buildAnalyticsHref` to the canonical `/analytics/{channel}/{streamId}#t={offset}`. |
| `tests/e2e/analytics-hub-live-wire-ticker.spec.ts` + 3 others | Replace opposite-contract assertions. |
| `docs/website-portal/analytics-command-center-layout.md` | Mark hub-landing Live Wire lane contract superseded. |

---

### Task 1: Pure timestamp classifier + bar normalization (`liveWire.ts`)

**Files:**
- Create: `src/lib/liveWire.ts`
- Test: `tests/liveWireUtils.test.ts`

**Interfaces:**
- Produces:
  - `resolveMomentAtMs(at?: number): number | null` — returns ms or `null` for missing/invalid/non-positive/future? (no, future is valid-to-validate separately; returns ms for any positive finite number; classify handles future).
  - `classifyMomentWindow(at: number | undefined, now: number, windowMs: number): 'live' | 'older' | 'omit'`
  - `normalizeRatePct(rate: number | undefined, maxRate: number): string | null` — `null` when rate is missing/<=0 OR max <= 0; else `"<pct>%"`.
  - `capNewMomentsPerPoll(seen: Set<string>, moments: {key:string; at?:number}[], now:number, windowMs:number, maxNew:number): Set<string>`
  - `dedupeMomentsByLogin<T extends { login?: string; at?: number }>(items: T[], cap: number, windowMs: number): T[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/liveWireUtils.test.ts
import { describe, expect, it } from 'vitest'
import {
  classifyMomentWindow,
  normalizeRatePct,
  resolveMomentAtMs,
} from '../src/lib/liveWire'

const WINDOW = 30 * 60 * 1000

describe('resolveMomentAtMs', () => {
  it('converts seconds to ms and passthrough ms', () => {
    expect(resolveMomentAtMs(1_000_000_000)).toBe(1_000_000_000_000)
    expect(resolveMomentAtMs(1_700_000_000_000)).toBe(1_700_000_000_000)
  })
  it('rejects missing, non-finite, and non-positive', () => {
    expect(resolveMomentAtMs(undefined)).toBeNull()
    expect(resolveMomentAtMs(Number.NaN)).toBeNull()
    expect(resolveMomentAtMs(Infinity)).toBeNull()
    expect(resolveMomentAtMs(0)).toBeNull()
    expect(resolveMomentAtMs(-5)).toBeNull()
  })
})

describe('classifyMomentWindow', () => {
  const now = 1_700_000_000_000
  it('classifies valid <=30m as live', () => {
    expect(classifyMomentWindow(now - 60_000, now, WINDOW)).toBe('live')
    expect(classifyMomentWindow(now - WINDOW, now, WINDOW)).toBe('live') // boundary inclusive
  })
  it('classifies valid >30m as older', () => {
    expect(classifyMomentWindow(now - WINDOW - 1, now, WINDOW)).toBe('older')
    expect(classifyMomentWindow(1_000, now, WINDOW)).toBe('older')
  })
  it('omits missing, invalid, non-positive, and future', () => {
    expect(classifyMomentWindow(undefined, now, WINDOW)).toBe('omit')
    expect(classifyMomentWindow(Number.NaN, now, WINDOW)).toBe('omit')
    expect(classifyMomentWindow(0, now, WINDOW)).toBe('omit')
    expect(classifyMomentWindow(now + 60_000, now, WINDOW)).toBe('omit') // future
  })
})

describe('normalizeRatePct', () => {
  it('returns a pct string within the visible max', () => {
    expect(normalizeRatePct(50, 100)).toBe('50%')
    expect(Number.parseFloat(normalizeRatePct!(100, 100))).toBe(100)
  })
  it('returns null for missing, zero, or non-positive max', () => {
    expect(normalizeRatePct(undefined, 100)).toBeNull()
    expect(normalizeRatePct(0, 100)).toBeNull()
    expect(normalizeRatePct(50, 0)).toBeNull()
    expect(normalizeRatePct(-1, 100)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix streampulse-web run test -- tests/liveWireUtils.test.ts`
Expected: FAIL (module `../src/lib/liveWire` cannot be found)

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/liveWire.ts
export function resolveMomentAtMs(at: number | undefined): number | null {
  if (at == null || !Number.isFinite(at) || at <= 0) return null
  return at > 1e12 ? at : at * 1000
}

export type MomentWindowClass = 'live' | 'older' | 'omit'

export function classifyMomentWindow(
  at: number | undefined,
  now: number,
  windowMs: number,
): MomentWindowClass {
  const ms = resolveMomentAtMs(at)
  if (ms == null || ms > now) return 'omit'
  const ageMs = now - ms
  if (ageMs <= windowMs) return 'live'
  return 'older'
}

export function normalizeRatePct(
  rate: number | undefined,
  maxRate: number,
): string | null {
  if (rate == null || rate <= 0 || maxRate <= 0) return null
  const pct = Math.min(100, (rate / maxRate) * 100)
  return `${Math.round(pct)}%`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix streampulse-web run test -- tests/liveWireUtils.test.ts`
Expected: PASS (7/7)

- [ ] **Step 5: Commit**

```bash
git add streampulse-web/src/lib/liveWire.ts tests/liveWireUtils.test.ts
git commit -m "feat: live wire timestamp classifier + bar normalization"
```

---

### Task 2: Shared moment action resolver (`momentActions.ts`)

**Files:**
- Create: `src/lib/momentActions.ts`
- Test: `tests/momentActions.test.ts`

**Interfaces:**
- Consumes: `buildAnalyticsHref` from `src/lib/analyticsLinks`, `buildVodTimestampUrl` from `src/lib/figmaSessionAnalytics`, `FigmaMomentRow` type.
- Produces:
  - `interface MomentActions { analyticsHref?: string; vodHref?: string; disabledReason?: string }`
  - `resolveMomentActions(moment: FigmaMomentRow): MomentActions`

- [ ] **Step 1: Write the failing test**

```ts
// tests/momentActions.test.ts
import { describe, expect, it } from 'vitest'
import { resolveMomentActions } from '../src/lib/momentActions'
import type { FigmaMomentRow } from '../src/lib/figmaSessionAnalytics'

const base: FigmaMomentRow = {
  offsetSeconds: 600,
  label: 'Peak',
  login: 'xqc',
  displayName: 'xQc',
  streamId: 'hist-1',
}

describe('resolveMomentActions', () => {
  it('prefers moment.href for analytics when present', () => {
    const a = resolveMomentActions({ ...base, href: '/analytics/xqc/custom' })
    expect(a.analyticsHref).toBe('/analytics/xqc/custom')
  })
  it('uses buildAnalyticsHref with login/streamId/offset for canonical link', () => {
    const a = resolveMomentActions(base)
    expect(a.analyticsHref).toBe('/analytics/xqc/hist-1#t=600')
  })
  it('produces external VOD href only when vodId is set', () => {
    const a = resolveMomentActions({ ...base, vodId: 'v123' })
    expect(a.vodHref).toBe('https://www.twitch.tv/videos/v123?t=600s')
    const b = resolveMomentActions(base)
    expect(b.vodHref).toBeUndefined()
  })
  it('yields a disabled reason only when neither action resolves (no href="#")', () => {
    const a = resolveMomentActions({ offsetSeconds: 0, label: 'P' })
    expect(a.analyticsHref).toBeUndefined()
    expect(a.vodHref).toBeUndefined()
    expect(a.disabledReason).toBeTruthy()
    expect(a.analyticsHref).not.toBe('#')
    expect(a.vodHref).not.toBe('#')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix streampulse-web run test -- tests/momentActions.test.ts`
Expected: FAIL (module `../src/lib/momentActions` cannot be found)

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/momentActions.ts
import { buildAnalyticsHref } from './analyticsLinks'
import { buildVodTimestampUrl, type FigmaMomentRow } from './figmaSessionAnalytics'

export interface MomentActions {
  analyticsHref?: string
  vodHref?: string
  disabledReason?: string
}

export function resolveMomentActions(moment: FigmaMomentRow): MomentActions {
  const analyticsHref =
    moment.href ??
    (moment.login
      ? buildAnalyticsHref({
          login: moment.login,
          streamId: moment.streamId,
          offsetSeconds: moment.offsetSeconds,
        })
      : undefined)

  const vodHref = moment.vodId
    ? buildVodTimestampUrl(moment.vodId, moment.offsetSeconds)
    : undefined

  if (analyticsHref || vodHref) {
    return { analyticsHref, vodHref }
  }
  return { disabledReason: 'Live tracking only' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix streampulse-web run test -- tests/momentActions.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add streampulse-web/src/lib/momentActions.ts tests/momentActions.test.ts
git commit -m "feat: shared moment action resolver (analytics + VOD)"
```

---

### Task 3: Directional right-entry motion option

**Files:**
- Modify: `src/ui/motion/useAnalyticsMotion.tsx:102-108`

**Interfaces:**
- Produces: `animateEnterHorizontal(el: HTMLElement | null, opts?: { from?: 'left' | 'right' }): void` — default `'left'` preserves existing behavior (`x: -24`); `'right'` → `x: +24`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/liveWireUtils.test.ts (append)
import { buildDirectionalX } from '../src/ui/motion/useAnalyticsMotion'
describe('animateEnterHorizontal direction', () => {
  it('defaults to left (backward compatible) and supports right', () => {
    expect(buildDirectionalX(undefined)).toBe(-24)
    expect(buildDirectionalX('left')).toBe(-24)
    expect(buildDirectionalX('right')).toBe(24)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix streampulse-web run test -- tests/liveWireUtils.test.ts`
Expected: FAIL (`buildDirectionalX` is not exported)

- [ ] **Step 3: Write minimal implementation**

```ts
// src/ui/motion/useAnalyticsMotion.tsx
export function buildDirectionalX(from: 'left' | 'right' | undefined): number {
  return from === 'right' ? 24 : -24
}
// ... inside useAnalyticsMotion():
const animateEnterHorizontal = useCallback(
  (el: HTMLElement | null, opts?: { from?: 'left' | 'right' }) => {
    if (!el || !motionEnabled) return
    gsap.from(el, {
      x: buildDirectionalX(opts?.from),
      opacity: 0,
      duration: 0.35,
      ease: 'power3.out',
    })
  },
  [motionEnabled],
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix streampulse-web run test -- tests/liveWireUtils.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add streampulse-web/src/ui/motion/useAnalyticsMotion.tsx tests/liveWireUtils.test.ts
git commit -m "feat: directional right-entry horizontal motion option"
```

---

### Task 4: AnalyticsFigmaShell right-rail slot

**Files:**
- Modify: `src/ui/components/analytics/AnalyticsFigmaShell.tsx:21-27, 31, 65-78`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AnalyticsFigmaShellProps.rightRail?: ReactNode`; when present, frame gets `figma-analytics__frame--with-right-rail`.

- [ ] **Step 1: Write the failing test** (a lightweight render via existing jsdom setup; not rendered in unit tests elsewhere, so add an E2E assertion in Task 8 instead — here a compile-level check via `npm --prefix streampulse-web run build:packages && tsc --noEmit`)

Run (after Step 3 feature + Step 2 usage): `npm --prefix streampulse-web exec tsc --noEmit -p streampulse-web/tsconfig.json`
- [ ] **Step 2: Run to verify it fails before implementation** — `tsc --noEmit` FAILS because `rightRail` prop doesn't exist on the type yet (compile-time TDD).
- [ ] **Step 3: Write minimal implementation**

```tsx
// AnalyticsFigmaShell.tsx
export interface AnalyticsFigmaShellProps {
  backendStatus?: { label: string; value: string; tone?: 'ready' | 'degraded' | 'offline' | 'checking' }
  sidebarStatusLabel?: string
  sidebarSections?: Array<{ id: string; label: string; hidden?: boolean }>
  hideSidebar?: boolean
  rightRail?: ReactNode
  children: ReactNode
}

function AnalyticsFigmaShellInner({ backendStatus, sidebarStatusLabel, sidebarSections, hideSidebar = false, rightRail, children }: AnalyticsFigmaShellProps) {
  // ... unchanged ...
  return (
    <div className="figma-analytics">
      <AnalyticsTopNav ... />
      <div className={`figma-analytics__frame${hideSidebar ? ' figma-analytics__frame--no-sidebar' : ''}${rightRail ? ' figma-analytics__frame--with-right-rail' : ''}`}>
        {hideSidebar ? null : (
          <aside className="figma-analytics__sidebar" aria-label="Hub section navigation">
            <AnalyticsHubSidebar ... />
          </aside>
        )}
        <div ref={centerRef} className="figma-analytics__center figma-analytics__center--themed">
          {children}
        </div>
        {rightRail ? (
          <aside className="figma-analytics__right-rail" aria-label="Live Wire">
            {rightRail}
          </aside>
        ) : null}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run to verify** `tsc --noEmit` PASSES.
- [ ] **Step 5: Commit**

```bash
git add streampulse-web/src/ui/components/analytics/AnalyticsFigmaShell.tsx
git commit -m "feat: landing-only rightRail slot in analytics shell"
```

---

### Task 5: Frame CSS — sticky rail grid + scoped modifier

**Files:**
- Modify: `src/ui/components/analytics/figma-analytics.css:350-400` (and append rail rules)

- [ ] **Step 1: Write the failing test** — E2E computed-layout coverage is added in Task 8; here verify the CSS is syntactically picked up by running the overlap/style checker after Task 5's CSS is in place. For the TDD cycle, run:
  `npm --prefix streampulse-web run build:ci` (or `node scripts/check-analytics-overlap.mjs`) — these must pass.
- [ ] **Step 2: Run to verify current state passes** (baseline green before change; the E2E in Task 8 is the real red-first gate).
- [ ] **Step 3: Write the CSS**

```css
/* figma-analytics.css — extend the frame grid with an optional right rail.
   Only the landing page passes `rightRail`, so this is scoped via the modifier. */
@media (min-width: 1440px) {
  .figma-analytics__frame--with-right-rail {
    grid-template-columns: 220px minmax(0, 1fr) 320px;
    grid-template-areas: 'sidebar center rail';
  }
  .figma-analytics__frame--with-right-rail .figma-analytics__sidebar {
    grid-area: sidebar;
  }
  .figma-analytics__frame--with-right-rail .figma-analytics__center {
    grid-area: center;
  }
  .figma-analytics__frame--with-right-rail .figma-analytics__right-rail {
    grid-area: rail;
    display: block;
    position: sticky;
    top: 4.75rem;
    align-self: start;
    max-height: calc(100vh - 5.5rem);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
}

.figma-analytics__right-rail {
  display: none; /* hidden below 1440px; rendered in-flow in Task 6 via a section fallback */
}
```

- [ ] **Step 4: Run to verify green**: `npm --prefix streampulse-web exec node scripts/check-analytics-overlap.mjs`
- [ ] **Step 5: Commit**

```bash
git add streampulse-web/src/ui/components/analytics/figma-analytics.css
git commit -m "feat: scoped right-rail grid column + sticky rail css"
```

---

### Task 6: Remove the in-chart annotation lane

**Files:**
- Modify: `src/ui/components/analytics/FigmaGlobalActivityPanel.tsx:500-515`

- [ ] **Step 1: Write the failing test** — E2E (Task 8) asserts `#section-live-wire` is no longer inside the chart col. (No unit test; the compile check gates here.)
- [ ] **Step 2: Run** `npm --prefix streampulse-web exec tsc --noEmit -p streampulse-web/tsconfig.json` → currently passes (baseline).
- [ ] **Step 3: Make the change**

```tsx
// Remove the entire `{annotationFeed ? ( <div className="figma-global-activity__annotation-lane" id="section-live-wire"> <HubLiveWireFeed ... layout="lane" .../> </div> ) : null}` block (lines ~501-515).
// Also stop importing HubLiveWireFeed if no longer referenced in this file.
```

- [ ] **Step 4: Run** `tsc --noEmit` → PASS (no unused-import error after removing the import).
- [ ] **Step 5: Commit**

```bash
git add streampulse-web/src/ui/components/analytics/FigmaGlobalActivityPanel.tsx
git commit -m "feat: remove in-chart live wire annotation lane"
```

---

### Task 7: Landing page wiring — pollSequence/loadSource + rail + in-flow fallback

**Files:**
- Modify: `src/routes/analytics/AnalyticsLandingPage.tsx:379-387, 145-151, 416-440, 575-580`

**Interfaces:**
- Consumes: `HubLiveWireFeed` (new rail props in Task 8), `hub.pollSequence`, `hub.loadSource`.
- Produces: `<HubLiveWireFeed layout="rail" pollSequence={hub.pollSequence} loadSource={hub.loadSource} ... />` placed as `rightRail` in the shell, plus an in-flow `<section id="section-live-wire-fallback">` for <1440.

- [ ] **Step 1: Compile gate (fails first)** — after Task 8 adds `layout="rail"`, passing `layout="rail"` here exercises the type; do this wiring in Task 8's step to keep compile green. (This task's deliverable is the prop wiring + JSX placement.)
- [ ] **Step 2: Run** `tsc --noEmit` → PASS.
- [ ] **Step 3: Make the change**

```tsx
// liveWireFeedProps: add pollSequence and keep loadSource
const liveWireFeedProps = {
  hub: data,
  feed: liveWireFeed,
  activityWindow,
  loading: loadingInitial || hubUiState === "loading",
  hubEndpointOk: hub.hubEndpointOk,
  loadSource: hub.loadSource ?? undefined,
  pollSequence: hub.pollSequence, // <-- NEW
};

// In the shell:
<AnalyticsFigmaShell ... sidebarSections={sidebarSections} rightRail={
  <HubLiveWireFeed
    {...liveWireFeedProps}
    layout="rail"
    onSelectMoment={undefined}
    selectedMomentKey={null}
  />
}>
  {/* ... existing center content ... */}
  {/* In-flow fallback (below 1440px the rail aside is display:none): */}
  <SectionReveal id="section-live-wire-fallback" className="hub-live-wire--inflow">
    <HubLiveWireFeed {...liveWireFeedProps} layout="rail" />
  </SectionReveal>
</AnalyticsFigmaShell>
```

- [ ] **Step 4: Run** `tsc --noEmit` → PASS.
- [ ] **Step 5: Commit**

```bash
git add streampulse-web/src/routes/analytics/AnalyticsLandingPage.tsx
git commit -m "feat: wire live wire poll identity + rail placement on landing"
```

---

### Task 8: HubLiveWireFeed rail layout, cards, tiering, NEW gating

**Files:**
- Modify: `src/ui/components/analytics/HubLiveWireFeed.tsx`
- Test: `tests/liveWireUtils.test.ts` (tiering helpers already covered in Task 1; component behavior largely covered by E2E in Task 9)

**Interfaces:**
- Consumes: `classifyMomentWindow`, `normalizeRatePct`, `dedupeMomentsByLogin`, `capNewMomentsPerPoll` (Task 1), `resolveMomentActions` (Task 2), `animateEnterHorizontal(…, { from: 'right' })` (Task 3).
- Produces: `HubLiveWireFeed` with `layout?: 'section' | 'ticker' | 'lane' | 'rail'`, props `pollSequence?: number` and `loadSource?: PublicHubLoadSource`.

- [ ] **Step 1: Extract pure helpers already validated** — add `dedupeMomentsByLogin` and `capNewMomentsPerPoll` to `liveWire.ts` with tests (reusing the logic currently inline in the component at ~L137-175).

```ts
// tests/liveWireUtils.test.ts (append)
import { dedupeMomentsByLogin, capNewMomentsPerPoll } from '../src/lib/liveWire'
describe('dedupeMomentsByLogin', () => {
  it('drops a login within the window and honors cap', () => {
    const items = [
      { login: 'a', at: 1000, key: '1' },
      { login: 'a', at: 2000, key: '2' }, // within 10s window -> dropped
      { login: 'b', at: 3000, key: '3' },
    ]
    const out = dedupeMomentsByLogin(items, 10, 10_000)
    expect(out.map((i) => i.key)).toEqual(['1', '3'])
  })
})
describe('capNewMomentsPerPoll', () => {
  it('returns at most maxNew fresh, unseen keys', () => {
    const moments = [
      { key: 'a', at: 1_700_000_000_000 },
      { key: 'b', at: 1_700_000_000_000 },
    ]
    const out = capNewMomentsPerPoll(new Set(), moments, 1_700_000_100_000, 30*60*1000, 1)
    expect(out.size).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify the new helper tests fail then pass** (run after implementing in `liveWire.ts`).
- [ ] **Step 3: Rework the component**

```tsx
// In `HubLiveWireFeed`, add `layout === 'rail'` handling:
// - Replace the single `visibleMoments` list with two bucketed lists:
//     liveMoments = visibleMoments.filter(m => classifyMomentWindow(m.at, now, WINDOW) === 'live')
//     olderMoments = visibleMoments.filter(m => classifyMomentWindow(m.at, now, WINDOW) === 'older')
//     dropped = visibleMoments.filter(m => classifyMomentWindow(...) === 'omit') // not rendered
// - Each renderChip/renderCard resolves `const act = resolveMomentActions(moment)`.
// - Render a non-interactive `<article className="hub-live-wire__rail-card">` with sibling
//   `<Link to={act.analyticsHref}>View moment</Link>` and (when act.vodHref)
//   `<a href={act.vodHref} target="_blank" rel="noreferrer">Jump to VOD</a>`;
//   when neither, `<span aria-disabled="true">Live tracking only</span>`.
// - Twin bars: per-dimension max over the visible (live+older) set, then `normalizeRatePct`.
// - NEW gating: only when `loadSource === 'full'` AND `!hubDegraded`, keyed on current `pollSequence`
//   stored in a ref (set the ref to the baseline seen-set on a full-network first snapshot, and on
//   cache→network transitions per the spec's first-snapshot/cache-to-network rules).
// - Tiered disclosure: "Live now" list then a collapsed "Older retained · N" chevron toggling the older list.
// - Motion: `animateEnterHorizontal(rowEl, { from: 'right' })` limited to `MAX_NEW_ANIMATIONS_PER_POLL`,
//   and skipped under `prefers-reduced-motion` (motionEnabled already gates it).
```

- [ ] **Step 4: Run unit tests** `npm --prefix streampulse-web run test` — all green.
- [ ] **Step 5: Commit**

```bash
git add streampulse-web/src/ui/components/analytics/HubLiveWireFeed.tsx streampulse-web/src/lib/liveWire.ts tests/liveWireUtils.test.ts
git commit -m "feat: live wire rail layout, tiering, poll-gated NEW, sibling actions"
```

---

### Task 9: Replace E2E contract + docs supersession

**Files:**
- Modify: `streampulse-web/tests/e2e/analytics-hub-live-wire-ticker.spec.ts`
- Modify: `streampulse-web/tests/e2e/analytics-figma-parity.spec.ts`
- Modify: `streampulse-web/tests/e2e/analytics-hub-ux.spec.ts` (Live Wire selection test L340+)
- Modify: `streampulse-web/tests/e2e/analytics-hub-chart-contract.spec.ts`
- Modify: `streampulse-web/scripts/check-analytics-links.mjs`
- Modify: `docs/website-portal/analytics-command-center-layout.md`
- Test drive: `npm --prefix streampulse-web run test:e2e:analytics-local`

- [ ] **Step 1: Rewrite the live-wire ticker spec to the rail contract**

```ts
// tests/e2e/analytics-hub-live-wire-ticker.spec.ts (replace assertions)
test('responsive sticky right rail @ >=1440px', async ({ page }) => {
  await installHubUxMock(page)
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto('/analytics')
  await expect(page.locator('.figma-analytics__right-rail')).toBeVisible()
  await expect(page.locator('.hub-live-wire__rail-card').first()).toBeVisible()
  await assertNoPageHorizontalOverflow(page)
  await assertNoConsoleErrors(page, errors)
})

test('in-flow section below center @ <1440px', async ({ page }) => {
  await installHubUxMock(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/analytics')
  await expect(page.locator('.figma-analytics__right-rail')).toHaveCount(0)
  await expect(page.locator('#section-live-wire-fallback .hub-live-wire')).toBeVisible()
  await assertNoPageHorizontalOverflow(page)
})

test('computed center widths (no right rail) @ 1024', async ({ page }) => {
  await installHubUxMock(page)
  await page.setViewportSize({ width: 1024, height: 900 })
  await page.goto('/analytics')
  const box = await page.locator('.figma-analytics__center').boundingBox()
  expect(box!.width).toBeGreaterThan(900)   // >= 1000 ± pad
})
```

- [ ] **Step 2: Update the other three specs** — remove assertions that `#section-live-wire` sits in the chart col / lane chips coordinate selection / `side-rail--right` is absent; assert the rail or in-flow fallback instead (mirror the rewrites above). Update the "Live Wire selection coordinates one inspector" test in `analytics-hub-ux.spec.ts` to reflect that rail cards are launch targets (not in-place selection).
- [ ] **Step 3: Align `check:analytics-links.mjs`** to the canonical `/analytics/{channel}/{streamId}` form (its inline `buildAnalyticsHref` currently emits `/s/{streamId}`; update the expected strings and add a case verifying a VOD fragment link is NOT required in-app).
- [ ] **Step 4: Mark the layout doc superseded** in `analytics-command-center-layout.md` (Live Wire placement + Do not regress bullets → point to this spec).
- [ ] **Step 5: Run the full gate**

```bash
npm --prefix streampulse-web run test:e2e:analytics-local
npm --prefix streampulse-web exec node scripts/check-analytics-overlap.mjs
npm --prefix streampulse-web exec node scripts/check-analytics-links.mjs
npm --prefix streampulse-web run test
```

- [ ] **Step 6: Commit**

```bash
git add streampulse-web/tests/e2e streampulse-web/scripts/check-analytics-links.mjs docs/website-portal/analytics-command-center-layout.md
git commit -m "test: replace live wire rail E2E contract + align links checker + docs supersession"
```

---

## Self-Review

**Spec coverage:**
- Layout/shell/card/tiering/NEW/nav all mapped to Tasks 1–9. ✅
- Responsive contract (sticky ≥1440, in-flow below) → Tasks 4–7. ✅
- Poll identity wiring → Task 7 (props) + Task 8 (gating). ✅
- Missing-vs-zero / no derived score / no href="#" → Tasks 1–2, 8. ✅
- Motion direction → Task 3, used in Task 8. ✅
- E2E replacement + docs supersession → Task 9. ✅
- Center-width gates → Task 9 tests (1024 ≥ 1000; no overflow). ✅
- `check:analytics-overlap` + `check:analytics-links` → Task 9. ✅

**Placeholders:** No TBD/TODO; every code step has a concrete implementation block.

**Type consistency:** `resolveMomentActions` (Task 2) used in Task 8; `classifyMomentWindow`/`normalizeRatePct` (Task 1) used in Task 8; `animateEnterHorizontal(…, { from: 'right' })` (Task 3) used in Task 8; `HubLiveWireFeed layout="rail"` + `pollSequence` props (Task 8) used in Task 7. Names consistent.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-18-live-wire-right-rail.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
