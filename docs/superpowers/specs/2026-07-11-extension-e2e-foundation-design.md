# Extension E2E foundation (phased cycle 1)

**Goal:** Deterministic Playwright suite that loads the production `dist/` MV3 bundle unpacked, against mocked Twitch pages and mocked StreamPulse BFF, as a reviewable PR-gate foundation.

**Out of scope this PR:** full state matrix, broad visual baselines, full a11y, long leak soaks, BrowserStack, live Twitch as PR gate, production Sentry init.

## Architecture

```text
Chromium persistent context
  --load-extension=dist/   (production vite build)
  --disable-extensions-except=dist/
        │
        ├─ content script matches https://www.twitch.tv/*
        │     └─ page.route fulfills local HTML fixtures (chat column + live/offline/VOD DOM)
        │
        └─ service worker fetch → api.streampulse.stream
              └─ context.route fulfills fixture-driven JSON / errors / delays
```

Storage is seeded via `chrome.storage.sync` on the extension service worker (not page `localStorage`). Failure evidence uses Playwright `trace=on-first-retry`, `screenshot=only-on-failure`, `video=retain-on-failure`, plus attached console / SW console / failed-request logs.

## File map

| Path | Responsibility |
|------|----------------|
| `playwright.config.ts` | Root config; projects `extension-mocked` (default) and `live-twitch` (tag-gated stubs) |
| `package.json` | Scripts: `test:e2e`, `test:e2e:mocked`, `test:e2e:live` |
| `tests/e2e/helpers/extensionContext.ts` | Persistent context, extension ID, SW wait, storage seed/read, SW restart |
| `tests/e2e/helpers/mockTwitch.ts` | Route Twitch origins; SPA navigate without reload; live/offline/VOD DOM |
| `tests/e2e/helpers/mockApi.ts` | Fixture-driven BFF route handler + request counters |
| `tests/e2e/helpers/evidence.ts` | Page/SW console capture, failed network list, attach on failure |
| `tests/e2e/helpers/assertions.ts` | Single root, no uncaught errors, permission/localhost checks |
| `tests/e2e/fixtures/api/*.json` | Minimal pulse/coverage/health/vod payloads |
| `tests/e2e/fixtures/twitch/*.html` | Channel live, offline, VOD shells with chat column |
| `tests/e2e/specs/states.mocked.spec.ts` | live ready/partial, helix off, offline, VOD ready/syncing, 500/timeout/malformed |
| `tests/e2e/specs/lifecycle.mocked.spec.ts` | clean install, SW restart, settings persistence, SPA nav, single root |
| `tests/e2e/specs/quality.mocked.spec.ts` | no uncaught errors, no duplicate poll storm, manifest permissions |
| `tests/e2e/specs/live-twitch.canary.spec.ts` | `@live-twitch` stubs only (`test.skip`) |
| `.github/workflows/ci.yml` | `extension-e2e` job + failure artifacts |

## localhost:8081 decision

Keep `http://localhost:8081/*` and `http://127.0.0.1:8081/*` in the manifest — intentional local StreamPulse BFF opt-in (`isLocalStackBackendUrl`). Quality test asserts the **exact allowed** host permission set and fails if unexpected localhost ports (e.g. `:8090`, `:9876`) appear in `dist/manifest.json`.

## Acceptance checklist

- [x] `npm run build` then `npm run test:e2e:mocked` runs without live Twitch
- [x] Persistent context loads unpacked `dist/`
- [x] Twitch fixtures cover channel, VOD, SPA pushState nav
- [x] BFF fixtures drive listed states/errors
- [x] On failure: trace, screenshot, video, page+SW console, failed network artifacts
- [x] CI job uploads those artifacts on failure
- [x] `@live-twitch` project exists but is not a PR gate
- [x] No production Sentry changes
- [x] Manifest permission assertion documents localhost:8081 as intentional

## Cycle-1 test matrix (2026-07-11 local)

| Spec | Result |
|------|--------|
| lifecycle: clean install | PASS |
| lifecycle: browser restart + settings persist | PASS |
| lifecycle: SPA channel↔VOD | PASS |
| lifecycle: single root after SPA hops | PASS |
| quality: manifest permissions | PASS |
| quality: no uncaught errors (live-ready) | PASS |
| quality: no poll storm (8s window) | PASS |
| states: live ready | PASS |
| states: live partial/starting | PASS |
| states: Helix off | PASS |
| states: offline | PASS |
| states: VOD ready | PASS |
| states: VOD syncing | PASS |
| states: API 500 | PASS |
| states: timeout | PASS |
| states: malformed JSON | PASS |
| live-twitch canary | stubbed / not PR gate |

**16/16 mocked tests passed** (`npm run test:e2e:mocked`, ~22s).

## Defects found by this suite (fixed in-cycle)

1. **Live poll restart loop** — `livePoll.sync()` always called `tick()`; `PULSE_UPDATE` → sync → tick created uncontrolled GET_PULSE traffic (~3k+/8s). Fixed by skipping kick when a timer/tick is already active.
2. **Dead Infinity live detection** — `Number.isFinite(video.duration) && duration === Infinity` is unreachable. Fixed.
3. **MAIN-world GQL inject closure** — `executeScript(() => gqlDiscoverVodInPage(login))` minifies to `ReferenceError: I is not defined` on canBackfill paths. Fixed by passing `func` + `args`.
4. **Undebounced cache revalidate** — GET_PULSE cache hits always `void revalidatePulse(...)`. Debounced to 5s.

## Follow-up PR scope

Remaining state matrix, visual baselines, axe on Pulse root, leak soaks, live canary execution, storage migration matrix, fuller HTTP status coverage, BrowserStack.
