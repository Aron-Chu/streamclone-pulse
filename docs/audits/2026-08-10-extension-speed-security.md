# Streamclone Pulse — speed + security audit

Read-only review. No source was modified. Findings ranked most-severe first.

## Bundle size (current state)

| Bundle | Bytes | Gz |
|---|---|---|
| `dist/content/twitch.js` | 547 kB | 162 kB |
| `dist/background/service-worker.js` | 34 kB | 10 kB |
| `dist/popup/popup.js` | 11.9 kB | 4.3 kB |
| `dist/options/options.js` | 14.7 kB | 4.9 kB |
| `dist/chunks/jsx-runtime.js` | 184.6 kB | 53.0 kB |

Under the 600 kB content budget. MV3 module worker.

---

## Speed — top 5 (full list in speed-audit-findings.md)

### S1 · `RecapTimelineChart.tsx:386` — emote legend chip re-renders every parent render

Inline `style={{ ... }}` + arrow `onClick={() => toggleSeriesFocus(overlayKey)}` on every chip. Each `PulseEmoteImg` (file `PulseEmoteImg.tsx:17`) is a plain function component, not `memo`. With 5 overlays, every pulse poll re-mounts 5 imgs + the legend.

**Fix:** wrap `PulseEmoteImg` in `memo`; turn the chip into its own `memo` component with stable per-emote callbacks via `useCallback`.

### S2 · `ChartPositionRail.tsx:350-414` — inline style objects on every render

Four inline `style={{ ... }}` blocks (track, thumb, left resize handle, right resize handle). `ChartPositionRail` is `memo`'d at line 122, but every pan/zoom frame sends a fresh `viewport` prop, which re-creates the four style objects and breaks the memo's bail-out.

**Fix:** precompute `{...styles.track, height, touchAction}` via `useMemo` keyed on `[height]`; module-scope the static handle styles.

### S3 · `PulseOverviewChart.tsx:526-566` — global `pointerdown` listener re-attached on every poll

`useEffect` deps `[clearSelectionBoundaryRef, onHoverOffsetChange, onClearSelection]`. The two callbacks are not wrapped in `useCallback` upstream in `RecapTimelineChart.tsx`, so they get fresh identity on every pulse update → listener is detached and re-attached dozens of times per minute.

**Fix:** wrap the upstream callbacks in `useCallback`, or read latest values from refs (the file already uses this pattern for `onClearPinRef` at line 243).

### S4 · `entry.ts:466-478` — MutationObserver scoped to `document.documentElement`

`observer.observe(document.documentElement, { childList: true, subtree: true })`. The filter `shouldScheduleSnapMeasureFromMutations` drops chat-message churn, but `documentElement` is the whole DOM (larger than `document.body`). Chat rosters, hype trains, player chrome, and ad slots all fire here. The 500 ms URL-poll at line 493 is already a backstop that does the same job.

**Fix:** observe `document.body` instead of `document.documentElement`, or drop the observer and rely on the URL-poll for live/offline flips.

### S5 · `service-worker.ts:196-215` — `broadcastPulse` fans the full payload to every Twitch tab

Every poll fires `chrome.tabs.query({ url: ['*://*.twitch.tv/*'] })` then `chrome.tabs.sendMessage(tab.id, message)` to each. The payload contains the full `PulsePayload` (~30 kB JSON for a busy channel). 5 tabs = 5 serializes + 5 parses per poll.

**Fix:** cache tab IDs across polls, gate the broadcast on rollup-hash deltas, or use long-lived `chrome.runtime.connect` ports.

### S6 · `api.ts:25-48` — `getBackendUrl()` reads `chrome.storage.local` per request

Every API entry point awaits `getBackendUrl()` before fetching. On a parallel page-load burst (pulse + coverage + history + clips), that's 4 sequential storage reads.

**Fix:** module-level memoized `Promise<string>` for the URL, invalidated on `chrome.storage.onChanged`.

### S7 · `PulseOverviewChart.tsx:1012-1029` — `flushHoverIndex` re-runs 20+ `useMemo`s per hover frame

`hoverIndex` lives as `useState` in the outer `PulseOverviewChart`. Every pointer move re-runs all `useMemo` blocks (lines 588-879) even though the only visual that needs to update is `OverviewChartMotionChrome` (line 193-315).

**Fix:** hoist `hoverIndex` into the crosshair component or move to a ref + force-update only `OverviewChartMotionChrome`.

### S8 · `PulseOverviewChart.tsx:808-878` — four `smoothLinePathInBand` per render

Allocates ~4000 `{x,y}` objects + four path strings per pan/zoom frame for long VODs.

**Fix:** cap to ~120 display points on the live chart (panel is ~300 px; the portal already does this via `decimateSeriesForRender`).

### S9 · `chartRollupUtils.ts:847-877` — `emoteSpikeIndices` O(n log n) per render

Sorts the full `positives` array (1000 entries) on every poll / width / axis-max change.

**Fix:** use quickselect for the median instead of a full sort.

### S10 · `PulseOverviewChart.tsx:1139-1174` — wheel listener does not rAF-coalesce

`handleWheelZoom` runs synchronously per wheel event, re-creating the `useCallback` because `internalViewport` is in the dep array.

**Fix:** rAF-coalesce the wheel delta; or store `internalViewport` in a ref and only put stable callbacks in the deps.

---

## Security

### Sec1 · No `sender.id` / `sender.url` validation in service worker

`chrome.runtime.onMessage.addListener` at `service-worker.ts:342` does not validate `sender.id`, `sender.url`, or `sender.origin`. Any content script on a `*.twitch.tv/*` page can fire messages. Combined with the MV3 content-script model, this is expected — content scripts are trusted by host. But:

- Any future XSS on Twitch lets the page call `chrome.runtime.sendMessage({ type: 'TRACK', login })` and `HINT_VOD` / `LOAD_MISSED_MOMENTS` (which call `postVodHint` / `postPulseBackfill` — backend mutations).
- No `externally_connectable` allowlist is set, so external web pages can't reach the worker. **Good.**
- No `web_accessible_resources` is declared. **Good.**

**Recommendation (defense-in-depth, not a fix):** add a sender-id allowlist at the top of the listener. Cheap (one Map lookup), closes the XSS-relay gap. P2 priority.

### Sec2 · Three places attach `chrome.storage.onChanged` — all guarded

- `entry.ts:80` (content-script lifecycle)
- `mount.tsx:106` (theme sync) — guarded with `themeListenerInstalled`
- `mount.tsx:464` (mount storage) — guarded with `mountStorageListenerInstalled`

All three use boolean-flags to prevent double-install. **No leak.**

### Sec3 · Zero XSS sinks

`grep -rn 'dangerouslySetInnerHTML\|eval\|new Function'` over `src/` returns **zero matches**. All `document.documentElement.innerHTML` reads are *reads* (regex extraction of VOD IDs), never written. `JSON.parse` calls (2 total: `twitchPageInject.ts:93`, `normalizeVodPulseFetch.ts:195`) are wrapped in `try/catch`.

### Sec4 · Manifest is minimal

```
manifest_version: 3
permissions: ["storage", "scripting"]
host_permissions:
  - http://localhost:8081/*
  - http://127.0.0.1:8081/*
  - https://api.streampulse.stream/*
  - https://*.twitch.tv/*
```

No `all_urls`, no `tabs`, no `webRequest`, no `notifications`. CSP inherited from MV3 default (no `eval`, no `unsafe-inline`).

### Sec5 · `fetch('https://gql.twitch.tv/gql', { credentials: 'include' })`

`background/twitchPageInject.ts:81` — uses the user's Twitch cookie to identify the broadcaster. Public GQL endpoint. `clientId` is the same id Twitch's own page shell emits (commented at line 73-76). Legitimate, documented pattern. **Not a finding.**

### Sec6 · Storage keys sanitized

`storage.ts` uses typed key constants; read paths validate value types (`typeof next === 'string'`, range checks on preferences). `syncSet` validates `Extension context invalidated` so transient SW teardown doesn't reject activations.

### Sec7 · Message types are discriminated unions

`shared/messages.ts` defines `BackgroundRequest` / `BackgroundResponse` as discriminated unions. The service worker switches on `message.type` (line 346). Type-narrowed in TypeScript; at runtime an unknown type falls through with no response, which is the safe default (the message simply times out).

---

## What I did NOT find (worth saying)

- **No tear-down leaks in dirty tree**: `entry.ts:511-531` `disposeContentLifecycle` and `twitchLayout.ts:263-274` cleanup correctly disconnect observers, clear intervals, remove listeners. The dirty-tree teardown fix is good.
- **No setTimeout(string) / setInterval(string)** anywhere.
- **No `web_accessible_resources`** — extension pages are isolated.
- **No `unsafe-eval`** in CSP (MV3 default).
- **`extensionPeakOffsetSeconds`** is not invoked per render; chart uses the empty constant `NO_MINUTE_ROLLUPS`. Heavy `rollupsToChartMinuteRollups` work was already moved out of the hot path (commented at lines 102-108).
- **No `Math.random()` / non-deterministic seed leaks** in chart math.

---

## Recommended priority

| Priority | Finding | Effort | Impact |
|---|---|---|---|
| P0 | (none — speed is fine on idle, drags under load) | — | — |
| P1 | S1 (legend chip memo), S3 (pointerdown re-attach), S5 (broadcastPulse fan-out) | ~1 day combined | big for busy tabs / busy channels |
| P2 | S2, S4, S6, S7, S8, S9, S10 + Sec1 (sender-id allowlist) | ~2 days combined | steady-state perf, defense-in-depth |

Bundle is under budget. Manifest is minimal. Storage and message surfaces are well-typed. The biggest wins are inside the chart's render path (S1, S3, S7) and the broadcast fan-out (S5).