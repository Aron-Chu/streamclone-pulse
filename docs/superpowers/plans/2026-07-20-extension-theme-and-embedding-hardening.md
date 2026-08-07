# Extension Theme and Embedding Hardening Implementation Plan

> **For the AI agent working this:** Required sub-skill: use
> `executing-plans` to implement this plan task by task. Stop at every stated
> gate. Do not combine this into one broad patch.

**Goal:** Remove current release blockers, harden Twitch embedding, and deliver
the approved Auto/Light/Dark Pulse surface theme without changing backend
scoring or silently restoring disputed product features.

**Architecture:** The service worker remains the only HTTP boundary. Twitch
navigation and theme detection are small testable content-layer helpers. Both
Pulse Shadow DOM hosts receive host-local semantic surface variables. Storage
keeps color scheme separate from accent palette. Every remediation slice has a
focused red/green test gate.

**Tech stack:** Chrome MV3, React 18, TypeScript 6, Vitest, Playwright, Vite 8.

## Files and responsibilities

- Create `src/content/twitchTheme.ts` - detect and observe Twitch light/dark
  root classes.
- Create `src/ui/surfaceTheme.ts` - semantic light/dark palettes and host
  variable application.
- Create `tests/twitchTheme.test.ts` - detector and observer contract.
- Create `tests/surfaceTheme.test.ts` - palette application contract.
- Create `tests/networkBoundary.test.ts` - forbid direct content/UI HTTP.
- Create `tests/e2e/specs/theme.mocked.spec.ts` - visual and dynamic theme
  behavior.
- Modify `src/shared/storage.ts` and `tests/optionsSettings.test.ts` - persist
  normalized `auto | light | dark` independently from accent.
- Modify `src/content/mount.tsx` - host theme sync, duplicate-mount guard, error
  clearing, and no direct telemetry.
- Modify `src/content/entry.ts` and lifecycle E2E tests - activation generation
  and non-starvable URL synchronization.
- Modify `src/content/twitch.ts` and `tests/twitch.test.ts` - non-channel route
  contract and primary-video ranking.
- Modify `src/background/api.ts`, `src/background/service-worker.ts`, and focused
  background tests - authenticated, non-destructive Protect sync and structured
  errors.
- Modify `src/content/twitchChat.ts`, `src/content/twitchSidebarChrome.ts`, and
  `tests/twitchChat.test.ts` - scope Twitch selectors and layout measurement.
- Modify `src/ui/theme.ts`, `src/ui/chartTheme.ts`, `src/ui/Overlay.tsx`,
  `src/ui/PulseSettingsPanel.tsx`, `src/ui/PulseThemedSelect.tsx`, and directly
  affected UI components - semantic surface tokens, controls, focus, portal
  isolation, and contrast.
- Modify `manifest.json` and manifest quality tests - remove `127.0.0.1:7271`.
- Modify Twitch mocked fixtures - expose light/dark root classes and narrow
  sidebar layouts.

## Preflight: preserve the active worktree

**Step 1: Read ownership and design sources**

Read `AGENTS.md`, `docs/CONTEXT.md`, `docs/pulse-extension/requirements.md`,
`docs/pulse-extension/design.md`,
`docs/superpowers/specs/2026-07-20-extension-smart-theme-design.md`, and
`docs/pulse-extension/extension-embedding-audit-2026-07-20.md`.

**Step 2: Inspect the dirty worktree**

```bash
git status --short --branch
git diff -- src/content src/background src/shared src/ui manifest.json tests
```

Expected: a dirty checkout. Do not reset, restore, or overwrite existing edits.
If an audited block has already changed, re-read it and adapt the smallest fix.

**Step 3: Record the baseline without committing**

```bash
npm test
npm run typecheck
npm run build
```

Expected: record exact pre-existing failures. Do not claim a new regression for
a failure that exists before the first edit.

**Commit:** Do not commit; the user has not authorized commits.

## Task 1: Remove direct loopback telemetry

**Files:**

- Create `tests/networkBoundary.test.ts`
- Modify `src/content/mount.tsx`
- Modify `src/ui/GamesPlayedStrip.tsx`
- Modify `src/ui/chatActivityEmotes.ts`
- Modify `src/ui/chartRollupUtils.ts`
- Modify `manifest.json`
- Modify the existing manifest permission test

**Step 1: Write the failing source-boundary test**

Scan `src/content/**/*.{ts,tsx}` and `src/ui/**/*.{ts,tsx}`. Fail if a file
contains a direct `fetch(` call. Keep a small explicit allowlist only if a
content-owned public asset fetch is documented by architecture; do not allow
loopback or backend requests.

Also assert `manifest.json` does not contain `127.0.0.1:7271`.

**Step 2: Run red**

```bash
npx vitest run tests/networkBoundary.test.ts tests/manifestStartup.test.ts
```

Expected: failures name the four direct telemetry files and the host permission.

**Step 3: Remove the telemetry blocks and permission**

Delete the direct POST blocks. Do not replace them with console logs or another
collector. Preserve actual data transforms and rendering.

**Step 4: Run green**

```bash
npx vitest run tests/networkBoundary.test.ts tests/manifestStartup.test.ts tests/gamesPlayedStripLayout.test.ts tests/chatActivityEmotes.test.ts tests/chartRollupUtils.test.ts
```

Expected: zero failures and no request to port 7271 in the built manifest.

**Gate:** Stop if any direct HTTP remains in `src/content` or `src/ui`.

**Commit:** Do not commit; the user has not authorized commits.

## Task 2: Make Protect synchronization authenticated and non-destructive

**Files:**

- Modify `src/background/api.ts`
- Modify `src/background/service-worker.ts`
- Add or modify focused background API/service-worker tests

**Step 1: Add failing API-header tests**

Assert both always-tracked GET and POST use the same `pulseRequestHeaders()`
contract as watch requests, including JSON content type for POST.

**Step 2: Add failing reconciliation tests**

Cover:

- empty local watchlist plus non-empty backend list does not send removals;
- failed backend/local read sends no mutations;
- explicit user removal sends exactly one `track: false`;
- explicit add sends exactly one `track: true`;
- storage listener does not duplicate the explicit mutation.

**Step 3: Implement explicit-delta behavior**

Use full list reads for display/hydration only. Never infer backend deletion from
local absence. Route add/remove intent through one mutation owner.

**Step 4: Run focused tests**

```bash
npx vitest run tests/pulsePrefetch.test.ts tests/settingsWiring.test.ts
```

Include newly created background test files in the command.

Expected: authenticated headers and exact mutation counts pass.

**Gate:** Stop if a fresh install or failed read can still emit `track: false`.

**Commit:** Do not commit; the user has not authorized commits.

## Task 3: Eliminate stale activation and navigation starvation

**Files:**

- Modify `src/content/entry.ts`
- Modify `tests/e2e/specs/lifecycle.mocked.spec.ts`
- Modify Twitch E2E helpers only as needed to issue URL-only main-world
  navigation and sustained chat mutations

**Step 1: Add failing race tests**

Add cases for delayed channel A response followed by A -> B and A -> directory.
Resolve A last. Assert only B mounts in the first case and no host mounts in the
second.

**Step 2: Add the chat-churn navigation test**

Append a chat node every 50-100 ms while calling main-world `pushState()` to a
new channel without replacing the body. Assert activation finishes within two
seconds and only one host pair exists.

**Step 3: Add an activation generation**

Increment a generation on every activation/deactivation. Capture it at async
operation start and verify it after every await before state mutation, mount,
or poll start.

**Step 4: Separate URL sync from DOM churn**

Do not reset the only route timer for every mutation. Use a bounded URL watcher
or narrowly scoped main-world bridge and keep DOM observation for live/layout
signals only.

**Step 5: Run focused E2E**

```bash
npm run build
npx playwright test tests/e2e/specs/lifecycle.mocked.spec.ts --project=extension-mocked --workers=1
```

Expected: race, URL-only navigation, chat-churn navigation, and single-root
assertions pass.

**Gate:** Stop if a stale response can mount after route change.

**Commit:** Do not commit; the user has not authorized commits.

## Task 4: Harden route parsing and duplicate mounting

**Files:**

- Modify `src/content/twitch.ts`
- Modify `tests/twitch.test.ts`
- Modify `src/content/mount.tsx`
- Modify lifecycle E2E tests

**Step 1: Expand failing route tests**

At minimum assert non-channel for `/following`, `/search`, `/browse`,
`/downloads`, `/turbo`, `/wallet`, `/jobs`, `/store`, and `/login`, while
preserving channel and VOD cases.

**Step 2: Implement a maintainable route contract**

Prefer an exported system-route set with explicit tests. Do not call a path a
channel merely because it matches the login regex when known Twitch navigation
evidence says otherwise.

**Step 3: Add a document-level mount sentinel**

Before creating hosts, detect stale/duplicate extension hosts. Reuse the active
owned instance or remove stale hosts deterministically. Do not remove unrelated
page elements sharing only a partial selector.

**Step 4: Add reinjection coverage**

Inject the content bundle twice into one fixture and assert exactly one tabs
host, one panel host, and one effective observer/poll path.

**Step 5: Run focused tests**

```bash
npx vitest run tests/twitch.test.ts tests/mountPlacement.test.ts
npm run build
npx playwright test tests/e2e/specs/lifecycle.mocked.spec.ts --project=extension-mocked --workers=1
```

Expected: route matrix and reinjection pass.

**Commit:** Do not commit; the user has not authorized commits.

## Task 5: Preserve errors and clear them on recovery

**Files:**

- Modify `src/background/service-worker.ts`
- Modify `src/shared/messages.ts` only if the existing error field is
  insufficient
- Modify `src/content/mount.tsx`
- Add focused worker/mount tests
- Modify mocked states E2E coverage

**Step 1: Add failing failure/recovery tests**

Assert a 500/network failure yields an explicit error state and backoff signal,
then a valid payload clears that error and renders data.

**Step 2: Preserve structured errors**

Do not convert fetch failure into a successful null payload. Keep a bounded,
sanitized error message in the worker response.

**Step 3: Clear recovered errors**

When a valid payload arrives, clear `currentError` even when the caller omits an
error argument.

**Step 4: Run focused tests**

```bash
npx vitest run tests/livePoll.test.ts tests/pulsePrefetch.test.ts
npm run build
npx playwright test tests/e2e/specs/states.mocked.spec.ts --project=extension-mocked --workers=1
```

Expected: loading, explicit failure, and recovery states are distinguishable.

**Commit:** Do not commit; the user has not authorized commits.

## Task 6: Add color-scheme storage and Twitch detection

**Files:**

- Create `src/content/twitchTheme.ts`
- Create `tests/twitchTheme.test.ts`
- Modify `src/shared/storage.ts`
- Modify `tests/optionsSettings.test.ts`

**Step 1: Write failing storage tests**

Assert default `auto`, round trips for all three values, and invalid-value
normalization to `auto`. Confirm existing accent migration remains unchanged.

**Step 2: Write failing detector tests**

Cover light class, dark class, unknown fallback to dark, light/dark conflict
resolution, repeated mutations without duplicate callbacks, and cleanup.

**Step 3: Implement minimal storage and detector helpers**

Use `ColorSchemePreference = 'auto' | 'light' | 'dark'`. Observe only the root
class attribute. Keep resolver functions pure where possible.

**Step 4: Run green**

```bash
npx vitest run tests/optionsSettings.test.ts tests/twitchTheme.test.ts
```

Expected: all new and existing accent tests pass.

**Commit:** Do not commit; the user has not authorized commits.

## Task 7: Add semantic surface palettes and host synchronization

**Files:**

- Create `src/ui/surfaceTheme.ts`
- Create `tests/surfaceTheme.test.ts`
- Modify `src/ui/theme.ts`
- Modify `src/ui/chartTheme.ts`
- Modify `src/content/mount.tsx`

**Step 1: Write failing palette tests**

Assert every light/dark palette has the same semantic keys, application writes
only namespaced host variables, and the host receives the resolved scheme data
attribute. Add automated contrast assertions for text/background token pairs.

**Step 2: Implement palettes and variable application**

Apply variables separately to tabs and panel hosts. Do not write surface values
to Twitch's document root.

**Step 3: Convert shared theme values to CSS variable references**

Use current dark literals as fallbacks. Keep radii, font, accent, rank, live,
warning, and error semantics separate.

**Step 4: Wire mount synchronization**

Apply dark before first render, hydrate stored preference, update on storage or
Twitch class changes, and clean up the observer on unmount.

**Step 5: Run focused tests**

```bash
npx vitest run tests/twitchTheme.test.ts tests/surfaceTheme.test.ts tests/overlayTheme.test.ts tests/mountPlacement.test.ts
```

Expected: both hosts update without React remount or accent changes.

**Commit:** Do not commit; the user has not authorized commits.

## Task 8: Migrate visible UI surfaces and add the preference control

**Files:**

- Modify `src/ui/PulseSettingsPanel.tsx`
- Modify `src/ui/Overlay.tsx`
- Modify `src/ui/PulseOverviewChart.tsx`
- Modify `src/ui/PulseThemedSelect.tsx`
- Modify directly affected dock, card, row, and chart components
- Modify `src/ui/theme.ts`

**Step 1: Add failing control semantics tests**

Assert Auto/Light/Dark options have `aria-pressed`, persist, apply immediately,
and remain separate from Aurora/Volt/Azure.

**Step 2: Add a shared focus-visible rule**

Remove global outline suppression. Use a 2px accent ring with sufficient offset
and contrast in both schemes.

**Step 3: Migrate neutral literals**

Replace dark-only neutral backgrounds, borders, white alpha overlays, chart
grid/crosshair colors, input/menu surfaces, and shadows with semantic variables.
Do not change data series colors or client scoring.

**Step 4: Fix the custom select while touching its theme**

Portal into `portalRoot`, add complete Arrow/Home/End/Enter/Escape behavior,
restore trigger focus after selection/close, and flip above the trigger when
there is insufficient viewport space.

**Step 5: Run focused unit tests**

```bash
npx vitest run tests/optionsSettings.test.ts tests/surfaceTheme.test.ts tests/settingsWiring.test.ts
```

Add the new settings/select test files to this command.

Expected: controls are keyboard-operable and all surface consumers resolve in
both palettes.

**Commit:** Do not commit; the user has not authorized commits.

## Task 9: Add mocked visual and lifecycle coverage

**Files:**

- Create `tests/e2e/specs/theme.mocked.spec.ts`
- Modify Twitch fixtures and extension helpers
- Add screenshot snapshots generated by Playwright

**Step 1: Add behavior cases**

Test Auto dark, Auto light, dynamic root-class switch, Light override, Dark
override, persistence after worker restart, and accent independence.

**Step 2: Add layout matrix**

Cover sidebar widths 240, 280, 320, and 392 pixels, plus right, mini, and
collapsed modes. Assert no horizontal overflow and every control remains within
its host rectangle.

**Step 3: Add keyboard assertions**

Tab through settings and select controls. Assert visible focus and correct
selected state. Exercise select Arrow keys and Enter.

**Step 4: Capture screenshots**

Capture at least dark/light expanded sidebar and dark/light narrow sidebar.
Inspect the images; do not update snapshots blindly.

**Step 5: Run E2E**

```bash
npm run build
npx playwright test tests/e2e/specs/theme.mocked.spec.ts tests/e2e/specs/lifecycle.mocked.spec.ts --project=extension-mocked --workers=1
```

Expected: behavior, layout, keyboard, and approved screenshots pass.

**Gate:** Stop if light mode contains dark islands, unreadable text, clipped
controls, or Twitch-styled portal content.

**Commit:** Do not commit; the user has not authorized commits.

## Task 10: Scope Twitch sidebar DOM integration

**Files:**

- Modify `src/content/twitchChat.ts`
- Modify `src/content/twitchSidebarChrome.ts`
- Modify `tests/twitchChat.test.ts`
- Modify mocked Twitch fixtures and lifecycle E2E tests

**Step 1: Add adversarial fixtures**

Include a second chat-like region and unrelated buttons/banners matching current
global selectors outside the real chat column.

**Step 2: Mark and scope the resolved chat column**

Apply an extension-owned data attribute to the selected chat column. Scope hide
rules and descendant queries to it. Remove the marker on unmount or replacement.

**Step 3: Require geometry intersection**

Only use header/message/bottom candidates belonging to or horizontally
intersecting the selected column.

**Step 4: Preserve native Chat behavior**

When the Chat tab is active, do not hide native controls unless the documented
replacement UI supplies the same function and accessible name.

**Step 5: Run focused tests**

```bash
npx vitest run tests/twitchChat.test.ts
npm run build
npx playwright test tests/e2e/specs/lifecycle.mocked.spec.ts --project=extension-mocked --workers=1
```

Expected: unrelated controls remain visible and panel geometry uses one column.

**Commit:** Do not commit; the user has not authorized commits.

## Task 11: Final verification and product-conflict handoff

**Files:** no new production files unless a focused test reveals a regression.

**Step 1: Run complete extension validation**

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e:mocked
```

Expected: zero new failures. The build is mandatory because Chrome loads `dist/`.

**Step 2: Inspect network and manifest boundaries**

```bash
git diff --check
git diff -- manifest.json src/content src/background src/shared src/ui tests docs/superpowers docs/pulse-extension
```

Expected: no direct content/UI backend fetch, no port 7271 permission, no
scoring implementation, and no unrelated portal changes.

**Step 3: Report unresolved product conflicts without implementing them**

Create follow-up design requests for:

- R10 Save Moment/bookmarks;
- R11 backend lane rendering;
- R12 bounded post-end recap readiness;
- worker-only poll ownership and per-login watch deduplication;
- backend-origin cache isolation and custom-host permission policy.

Do not restore deleted files or alter requirements in this execution.

**Step 4: Browser handoff**

After the successful build, instruct the user to reload StreamPulse at
`chrome://extensions` and hard-refresh the Twitch tab.

**Commit:** Do not commit; the user has not authorized commits.
