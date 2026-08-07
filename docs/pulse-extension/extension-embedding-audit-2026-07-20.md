# Extension Embedding and Product Audit - 2026-07-20

**Scope:** Current local `master` worktree, including uncommitted changes.

**Method:** Read-only review of Twitch mounting/navigation, Shadow DOM and chat
integration, service-worker boundaries, settings/storage, feature requirements,
accessibility, responsive formatting, and current tests.

## Worktree warning

The checkout was 19 commits behind `origin/master` and already contained a very
large set of tracked and untracked changes. Several findings below are present
only in that dirty worktree. An implementation agent must preserve unrelated
changes, inspect every overlapping diff, and never restore deleted files merely
because an older requirement mentions them.

## Release blockers

### A1. Direct loopback telemetry in content/UI code

**Severity:** P0, confirmed in the dirty worktree

Normal rendering and data transforms issue direct requests to
`http://127.0.0.1:7271`, including payload-derived channel, stream, timing, game,
and rollup data. This violates the content-script service-worker boundary and
can execute repeatedly during render/calculation.

Affected paths:

- `src/content/mount.tsx`
- `src/ui/GamesPlayedStrip.tsx`
- `src/ui/chatActivityEmotes.ts`
- `src/ui/chartRollupUtils.ts`
- `manifest.json` includes the matching host permission

**Disposition:** Remove the instrumentation and permission before release. Add
a source boundary test that rejects direct `fetch()` from `src/content` and
`src/ui`, plus an E2E failed-request/request-log assertion.

### A2. Stale asynchronous channel activation

**Severity:** P0, confirmed

`activateChannel()` can finish after a Twitch SPA navigation and overwrite the
new session or remount after deactivation because awaited work has no generation
or cancellation check.

Affected path: `src/content/entry.ts`.

**Disposition:** Add an activation generation token and validate it after every
await before state mutation, mount, or poll startup. Test delayed A responses
across A -> B and A -> non-channel navigation.

### A3. SPA navigation starvation under chat churn

**Severity:** P0, confirmed by algorithm

The document-wide MutationObserver resets the same 400 ms timer on every Twitch
mutation. Sustained chat traffic can prevent route synchronization indefinitely,
and the interval fallback does not repair a changed session key.

Affected path: `src/content/entry.ts`.

**Disposition:** Separate URL/navigation detection from chat DOM observation.
Use a bounded, non-resettable route signal or URL poll, and filter chat mutations.
Test `pushState()` while appending chat nodes every 50-100 ms.

### A4. Hosted Protect reconciliation can issue destructive removals

**Severity:** P0, confirmed risk from current control flow

Always-tracked requests omit the standard beta request headers, and local
watchlist absence is treated as authority to send `track: false` for backend
entries. A fresh or failed local read can therefore remove protected backend
state.

Affected paths: `src/background/api.ts`, `src/background/service-worker.ts`.

**Disposition:** Use the standard authenticated request headers. Make explicit
user removal the only path that sends `track: false`; never reconcile removals
from an empty/failed read. Add principal-scoped and failed-read tests.

## High-priority correctness findings

### A5. Non-channel routes can be parsed as channels

**Severity:** P1, confirmed

The parser reserves only a small route set, so valid-looking paths such as
`/following`, `/search`, `/browse`, `/downloads`, `/turbo`, and `/wallet` can
mount Pulse as if they were channel logins.

Affected path: `src/content/twitch.ts`; current test covers only `/directory`.

**Disposition:** Expand and test the system-route contract or replace the
heuristic with a positive channel predicate supported by Twitch page evidence.

### A6. Isolated-world history patch is not a reliable route source

**Severity:** P1, integration risk

The content script patches `history.pushState` in its isolated world, while
Twitch navigation executes in the main world. Existing E2E helpers also replace
DOM, so they do not prove the history patch observes a URL-only navigation.

Affected paths: `manifest.json`, `src/content/entry.ts`.

**Disposition:** Use an independent URL watcher or a narrowly scoped main-world
navigation bridge. Add a URL-only main-world `pushState` test.

### A7. Sidebar snap mounts two effect-owning Overlay trees

**Severity:** P1, confirmed

Tabs and body each render a full `Overlay`. Effects execute before the
`sidebarPart` return branch, duplicating settings listeners and data requests.

Affected paths: `src/content/mount.tsx`, `src/ui/Overlay.tsx`.

**Disposition:** Split the effect/state owner from presentation or portal tabs
and body from one owner. Add per-request count assertions in snapped mode.

### A8. Backend failures become endless loading and stale errors survive recovery

**Severity:** P1, confirmed

`peekPulse()` converts failures to a successful-looking null payload. Separately,
`updateOverlayPayload()` does not clear an existing error when a valid payload
arrives with no error argument.

Affected paths: `src/background/service-worker.ts`, `src/content/mount.tsx`.

**Disposition:** Preserve structured failure messages through the worker and
clear error state on valid recovery payloads. Test API-down -> recovery.

### A9. Global Twitch hide rules and geometry queries are insufficiently scoped

**Severity:** P1, integration risk

Sidebar rules can match Twitch controls outside the resolved chat column, and
header/message/bottom geometry queries can combine unrelated elements.

Affected paths: `src/content/twitchSidebarChrome.ts`, `src/content/twitchChat.ts`.

**Disposition:** Mark the resolved chat column with an extension-owned attribute,
scope rules and descendant queries beneath it, require horizontal intersection,
and remove the marker on teardown.

### A10. No DOM-level duplicate mount guard

**Severity:** P1, integration risk

Single-instance state is module-local. Reinjection can append duplicate IDs and
independent observers.

Affected path: `src/content/mount.tsx`.

**Disposition:** Add a document-level sentinel and deterministic reuse/removal.
Test reinjection in the same document.

### A11. Poll ownership and watch deduplication are inconsistent

**Severity:** P1, confirmed architecture drift

Content tabs schedule hosted polling while local tracking also has worker-side
polling. Watch requests are not deduplicated by in-flight promise or time window.

Affected paths: `src/content/livePoll.ts`, `src/background/service-worker.ts`,
`src/background/tracking.ts`.

**Disposition:** Make the worker the sole scheduler in a dedicated change and
add per-login in-flight/TTL deduplication. This is not part of the theme patch.

### A12. Storage/backend-origin contracts are inconsistent

**Severity:** P1, confirmed

Getters and setters normalize differently, corrupted boolean strings become
truthy, arbitrary backend hosts conflict with fixed manifest permissions, and
session cache keys do not include backend origin.

Affected paths: `src/shared/storage.ts`, `src/options/options.tsx`,
`manifest.json`.

**Disposition:** Normalize on read and write, validate supported origins, and
clear or namespace caches on backend change.

## Formatting and accessibility findings

### A13. Keyboard focus is globally suppressed

**Severity:** P1, confirmed

The Shadow DOM base style removes button focus outlines, and individual controls
also suppress focus.

Affected paths: `src/content/mount.tsx`, `src/ui/theme.ts`,
`src/ui/PulseMomentRow.tsx`, `src/ui/GamesPlayedStrip.tsx`.

**Disposition:** Remove global outline suppression and provide a shared,
high-contrast `:focus-visible` ring.

### A14. The custom select is neither keyboard-complete nor fully isolated

**Severity:** P1 accessibility; P2 layout

Only Escape is implemented. Arrow/Home/End/Enter behavior and focus restoration
are missing. The menu portals to `document.body`, bypassing Shadow DOM isolation,
and always opens downward without collision handling.

Affected path: `src/ui/PulseThemedSelect.tsx`.

**Disposition:** Complete the listbox keyboard contract, portal into the Pulse
portal root, and flip above when needed. A native select is acceptable only if
the visual contract is deliberately changed.

### A15. Multiple controls lack accessible names or selected-state semantics

**Severity:** P1, confirmed

The auto-update switch lacks an accessible name; settings/options segmented
controls lack `aria-pressed`; some inputs/selects rely on placeholders.

Affected paths: `src/ui/Overlay.tsx`, `src/ui/PulseSettingsPanel.tsx`,
`src/options/options.tsx`.

**Disposition:** Add explicit labels and state semantics, including the new
surface-theme control.

### A16. Dark-only literals prevent a complete light theme

**Severity:** P1 for the approved theme feature

Shared tokens, chart chrome, menus, inline styles, hover states, and popup chrome
contain hard-coded dark neutral colors.

Affected paths include `src/ui/theme.ts`, `src/ui/overlayTheme.ts`,
`src/ui/chartTheme.ts`, `src/ui/Overlay.tsx`, `src/ui/PulseOverviewChart.tsx`,
`src/ui/PulseThemedSelect.tsx`, dock components, and popup/options HTML.

**Disposition:** Follow the approved semantic surface-token design. Keep data
series and status semantics stable.

### A17. Responsive and contrast coverage is incomplete

**Severity:** P2, confirmed test gap

Muted text is at or just below AA on some surfaces, scrollbars are globally
hidden, options uses a fixed width, and tests do not cover narrow sidebars,
overflow, light mode, or keyboard focus.

**Disposition:** Add token contrast tests and Playwright coverage at 240, 280,
320, and 392 pixel sidebars plus representative desktop/mobile viewports.

## Product-contract conflicts requiring explicit disposition

These are not safe automatic restorations because current dirty changes delete
supporting files and tests intentionally assert absence in places.

### A18. Save Moment/bookmark behavior conflicts with R10

The current UI/message contract omits Save Moment while requirements still
describe moment-row, chart-playhead, recap, and saved-list behavior.

**Action:** Product owner must either restore the feature through a separate
backend/UI plan or amend R10 and its tests. The theme/hardening agent must not
resurrect deleted bookmark files opportunistically.

### A19. Composite/per-signal lane rendering conflicts with R11

The payload exposes lanes, but the current chart derives series from rollups and
does not render the documented Pulse/Chat/7TV lane contract.

**Action:** Confirm the current backend lane schema and product intent, then
write a separate chart contract plan. Do not infer scoring client-side.

### A20. Recap loading/poll behavior conflicts with R12

Recap loading/error states are gated on an already-present recap, and polling
can stop before a post-stream recap becomes ready.

**Action:** Define a bounded post-end recap status/retry contract with the BFF in
a separate change.

## Lower-priority risks

- Primary video selection uses the first `video` element rather than ranking
  visible player-relative videos.
- Old sidebar geometry can briefly survive a route/session transition.
- Chat mode may still hide native Twitch header/community controls.
- Open Shadow Roots are style-isolated but inspectable by page scripts; this is
  acceptable unless stronger script isolation becomes a requirement.
- JavaScript count-up animation does not honor reduced motion.
- Status pills expose state in data attributes but have little visual severity
  differentiation.

## Recommended execution order

1. Remove loopback telemetry and the `:7271` permission.
2. Prevent destructive Protect reconciliation.
3. Fix activation races and non-starvable SPA navigation.
4. Fix error propagation/recovery and route false positives.
5. Scope Twitch DOM/CSS integration and add duplicate-mount protection.
6. Implement the approved smart surface theme plus focus/select fixes.
7. Address poll ownership, settings/cache normalization, and remaining a11y.
8. Resolve R10/R11/R12 product conflicts in separate approved designs.

Each slice must pass focused unit/E2E tests, `npm test`, `npm run typecheck`, and
the mandatory `npm run build`. Browser-visible slices also require Playwright
screenshots and a manual extension reload/hard-refresh check.
