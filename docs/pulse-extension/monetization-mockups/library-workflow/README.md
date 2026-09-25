# Pulse Library — frontend implementation and workflow preview

Date: 2026-09-04. Status: **implemented frontend with fixture-only repository; not mounted in the shipped extension**.

This replaces neither current bookmarks nor installed settings. It uses the real `SettingsHostShell`, `injectHostStyles`, `PulseSectionCard` and Aurora/Volt/Azure tokens. The full settings extension URL was blocked by the browser tool; source reuse is not a claim that its rendered page was inspected. Chrome was used to inspect/test this local implementation.

## Run the preview

From `streamclone-pulse`:

```powershell
node node_modules/vite/bin/vite.js --config docs/pulse-extension/monetization-mockups/library-workflow/vite.config.ts
```

Open `http://127.0.0.1:8178/`. Use the clearly labeled scenario control for empty, offline, full storage, load/write failures, free/expired membership and paginated data. Scenarios reset fixture data. They do not change real account status, billing, extension storage, browser history or Twitch playback. Export downloads fixture JSON, not real user data. Fixture VOD IDs are illustrative, not verified playable sources.

The preview reuses existing shell slots (`pulse`, `privacy`, `updates`) with preview labels. These mappings are **not** production navigation changes. Future mounting must add the appropriate canonical Library destination instead of overwriting Privacy/Updates.

## Product rules

| User action | History | Bookmarks |
|---|---|---|
| Hover/select a spike | No change | No change |
| Open a replay link/new tab | No change; playback not confirmed | No change |
| Seek fails | No change | May still save a reference manually |
| Confirmed explicit Pulse seek with stable source/offset, capture on, not incognito | Upsert one recent reference, with expiry | No change |
| Confirmed seek with capture off | No change | No change |
| Press Bookmark | No history is invented | Keep a bookmark, even without replaying |
| Save unavailable/unresolved source | No history is invented | Keep reference/note with replay unavailable |
| Clear or expire recent history | Remove/expire history | Saved records and notes survive |
| Remove saved moment | Separate recent jump may remain | Remove saved marker, note and collection association |

Do not infer successful watching from a URL, click, chart selection or replay-link opening. Stable live stream identity and verified source-relative offset can support recent history before a VOD exists; replay stays unavailable until a valid source resolves. Worker integration must use the existing successful-seek verifier at explicit action sites and stable canonical IDs, not untrusted page messages or rolling-buffer times.

## Component architecture and props

Source: [`src/ui/library`](../../../../src/ui/library).

| Component/module | Input contract | Responsibility |
|---|---|---|
| `LibraryWorkspace` | `repository`, `initialView?`, `onExport`, `onConfigureSync?`, `demoReference?`, `contexts?`, `presentations?`, `now?` | Orchestrate navigation, async load/mutations, empty/error feedback, search, 12-row pages and modal workflows. |
| `MomentSaveButton` | `moment`, `busy?`, `onSave` | Explicit save action; saved/disabled/pending states; no automatic capture. |
| `LibraryPeek` | `recent`, `loading?`, `historyEnabled`, `onOpenLibrary` | Thin existing-style sidebar card; at most three worker-projected entries, no full-settings CSS import. |
| `MomentListItem` | `moment`, `recent`, `busy`, save/edit/remove callbacks, optional link-open/preview callbacks and `presentation` | Media-led row, game at the moment, truthful origin label, note and source availability; safe replay link. |
| `MomentEditor` | `moment`, `collections`, `supporter`, `busy`, `error`, `onCommit`, `onClose` | Controlled note draft, character/byte validation, collection choice, failed-write preservation, discard protection. |
| `LibraryDialog` | `title`, children, `onClose`, `canClose?` | Native modal focus containment, Escape handling, labeling, focus restoration. |
| `StorageSettings` | `snapshot`, `busy`, change/export/clear callbacks, optional configure-sync callback | Capture consent, retention, capacity/persistence, export, clear confirmation, distinct sync state. |
| `LibraryWorkflow` | snapshot, optional demo reference and simulation callbacks | Explain save-versus-history and optionally exercise fixture actions. Omit simulation input in production. |
| `LibraryStatus` | `snapshot` | Local/offline/pending/syncing/synced/error projection. Never derive “backed up” merely from consent. |
| `useLibrary` | stable repository instance | Abort obsolete loads, serialize mutations, publish committed snapshots, retain old data/draft on failure, ignore stale account results. |
| `model.ts` | typed records/events and supplied clock | Pure filtering/expiry/deduplication, safe replay construction, note validation. |

Import the settings entry with dynamic import at its destination. Do not import the entire `index.ts` into the Twitch content bundle just to get a button; mount thin content-side controls using existing conventions and worker messages. The settings CSS must remain options-only. The components are not currently imported by any production entrypoint.

### Adapter contract

```ts
interface LibraryRepository {
  load(signal: AbortSignal): Promise<LibrarySnapshot>
  execute(command: LibraryCommand, signal: AbortSignal): Promise<LibrarySnapshot>
  export(signal: AbortSignal): Promise<string>
}
```

Commands discriminate save, unsave, edit, clear-history, preferences, create-collection and verified interaction. `LibrarySnapshot` separates moments, collections, capture preferences, membership, byte capacity/persistence and a discriminated sync state. Pass a new repository identity **and remount with the account namespace key** when account/device ownership changes. Keep the repository instance stable between renders.

```tsx
const LibraryWorkspace = lazy(() => import('./ui/library/LibraryWorkspace.tsx')
  .then(module => ({ default: module.LibraryWorkspace })))
```

Production adapter still required:

- Route through the extension worker; persist in extension-origin IndexedDB with transactions, schemas/migrations, absolute expiry, outbox/cursors and capacity checks. The demo adapter is deliberately in-memory and does not substitute for this work.
- Enforce canonical account ownership, payload validation, membership and quotas at the worker/BFF. UI disabled controls are not security boundaries.
- `load` must bound its projection. Current frontend filters a bounded local snapshot and renders 12 rows; this is **not** a server pagination implementation. Before large real libraries, extend the adapter with indexed query/cursor pages, global counts and complete export. Never load all records into a Twitch sidebar.
- Resolve mutations only after local durable commit. Abort protects UI state, but a remote operation may have committed before cancellation: reconcile and use idempotency keys rather than assuming abort rolled it back.
- Extend existing bookmark APIs/data through migration/adapter; fix continuation handling and composite cursor ties before sync/export. Preserve legacy saved data and rights.
- Connect `onConfigureSync` only when a real linked-account consent flow exists. It is intentionally absent/disabled in the preview. No fake successful upload or payment actions.
- Full export must include all authorized records and collections, regardless of the visible search/page. Native download helper is preview-only; integration needs filename/ownership/error review.

## Storage and package size

The settings page is an interface, **not another storage tier**. It shares extension-origin IndexedDB with the worker. More records do not increase the installation ZIP. Options-only lazy loading keeps the richer interface away from the Twitch content script.

Use existing small preference storage for settings; IndexedDB for bounded growing local metadata; existing Go BFF/Postgres for optional private account sync. Do not use Chrome sync storage as a growing history database. No videos, transcripts, chat logs or downloaded thumbnails in Library. Large media belongs in a separately authorized ReplayForge/media workflow, not “inside settings.” Local uninstall/profile loss can remove records; persistence permission is not backup. The displayed 25 MiB cap is the proposed product allowance, not the browser's quota or a measured VPS capacity.

Before persistence/sync implementation, follow [Library design](../supporter-v1/LIBRARY_DESIGN.md) and the control-plane Supporter build plan. Neither two VPS nor a connected Stripe plugin supplies account recovery, database replication or a tested backup automatically.

## Accessibility and responsive behavior

- Semantic navigation, lists, forms, labels, time values, native select/checkbox/meter/dialog; real links announce a new tab.
- Live status for completed actions/results, alert for failures; no false success on write failure. Error text remains inside an active modal.
- Native modal focus trap; Escape/Cancel routes through unsaved-edit protection; close disabled during commit; focus restores to opener or the Library heading if the row disappeared.
- Notes rendered as text, not HTML. Replay URLs constructed only for numeric Twitch VOD IDs and finite nonnegative positions.
- Thin focus outlines use existing accent tokens; state not conveyed by color alone; reduced-motion and forced-colors support.
- Settings shell retains its existing 860px rail-to-top-navigation breakpoint. Rows stack at 540px. Controls wrap, labels stay visible, touch controls get 44px minimum height, narrow editable fields use 16px text.
- No continuously animated skeletons or per-chat-message work. Loading skeletons reserve space and are hidden from the accessibility tree.

Automated DOM checks and keyboard/focus checks do not certify full WCAG conformance. Screen-reader, touch-device and extension Shadow DOM/real-browser integration testing remain release gates.

## Validation commands

```powershell
npm test -- src/ui/library
node node_modules/typescript/bin/tsc --noEmit -p docs/pulse-extension/monetization-mockups/library-workflow/tsconfig.json
node node_modules/vite/bin/vite.js build --config docs/pulse-extension/monetization-mockups/library-workflow/vite.config.ts
npm run build
npm run check:bundle-budget
```

Final run: **27 tests passed**, focused TypeScript passed, preview production build passed, extension build passed and the existing content bundle budget passed (579,846 raw / 166,431 gzip bytes, with no budget increase). New UI is not mounted, so those extension numbers do not measure the future integration's bundle delta. Preview build includes its own React runtime and is not an extension ZIP measurement.

Chrome checks covered history off/on, confirmed-seek versus bookmark distinction, save, note-discard protection and opener focus restoration, storage-full explanation, disabled real sync and 12-row pagination. Effective viewport geometry was checked at 360px, 736px and wide desktop; no horizontal overflow was found in the inspected views. The initial desktop screenshot was visually inspected. Later screenshot calls timed out after viewport testing; narrow checks used rendered DOM geometry, not screenshot certification. Temporary viewport override was reset.

Repo-wide TypeScript check currently reports an existing `SettingsWorkspace.tsx:311` disabled-prop mismatch outside this change; it was not modified. Both source shell files were already untracked before this task. No commits, account writes, real playback capture, server changes or extension reload were performed. Builds refreshed local ignored `dist` from the existing dirty checkout; do not reload the installed extension to see this preview—it is intentionally a separate local page.

## Refinement: previews, design language and feature boundaries

Visible navigation is now **Bookmarks / History / Collections / Storage & privacy / How saving works**. Internal `saved` and `recent` discriminants are intentionally unchanged; this is a naming refinement, not a storage migration.

New reusable pieces:

| Component | Props | Responsibility |
|---|---|---|
| `MomentPreview` | `moment`, optional `context` and `presentation`, `busy`, `error`, `onClose`, `onSave`, `onOpenLink` | Native modal with Overview, Analysis and Clip workflow tabs. Bookmark without implying playback. |
| `ReactionPreview` | `context: MomentContext` | Bounded one-minute chat samples; accessible values table; missing buckets remain gaps. |
| `MomentMedia` | `moment`, `presentation?`, `compact?` | Historical frame projection with sample offset, error fallback and exact bookmark timestamp. No current-live-image substitution. |
| `MomentSignal` | `presentation?` | One supplied baseline comparison, or explicitly unavailable. |
| `MomentStats` | `context: MomentContext` | Selected-minute viewers, messages/min, emote occurrences/min and emote density. Unknown values are not zero. |
| `MomentEmotes` | `context`, `compact?` | Three emotes in Overview, up to ten in Analysis; provider, static artwork, count and same-minute usage share. |
| `LibraryIcon` | `name` | Four static SVG action glyphs; no icon library, remote font or animation runtime. |

`MomentContextState` is ready/loading/unavailable. Ready data includes provenance, capture time, coverage, window label, at most 60 rendered samples, selected-minute counts and top emotes. It is a display projection, not a second scoring engine. Production must validate this data and request it through the worker, preferably on explicit inspection with bounded caching. Do not fetch per chat message. The fixture lives in `demoContexts.ts`, outside production. The unresolved-source fixture deliberately demonstrates loading; it is not an actual outstanding request.

**What each preview means:**

| Capability | This implementation | Production boundary |
|---|---|---|
| Reaction preview and analysis | Functional fixture charts/counts, gaps, emote breakdown, accessible table, unavailable/loading states | Existing backend measurements with timestamps/coverage. No inferred sentiment or fake AI summary. |
| Source playback | Timestamped Twitch links, not a player | Validate source availability; opening a link is not confirmed watching. |
| Video thumbnail / in-page video | Thumbnail component implemented with fallback; no verified video frames supplied in these fixtures and no in-page player | Optional authorized historical thumbnail, with sample offset and expired/error/consent states. A thumbnail is not an archive. |
| Cosmetics and badge previews | Remain a separate design surface; not moved into Library | Appearance should show Pulse-owned cosmetics in their actual panel/chat context and preserve other extensions' badges. No global Twitch visibility claim. |
| Full analytics | Not duplicated here | Existing Pulse panel/portal. Library preserves the context needed to revisit a moment. |
| ReplayForge | Disabled planned handoff with explicit prerequisites | Authorized source + valid candidate handoff + review/trim/render in the owning product. No automatic upload, publishing or included AI/render credits. |

Recommended settings destinations for eventual integration: **Pulse**, **Appearance**, **Library**, **Privacy & data**, **Account & Supporter**. This is an information-architecture proposal, not a claim those new destinations are mounted. Do not replace existing working settings with five empty screens.

**Design research and decisions (2026-09-04):**

- [Linear's interface refresh](https://linear.app/now/behind-the-latest-design-refresh): restrained navigation, predictable action placement and softer structural separation. Applied as quieter navigation and distinct Preview / secondary / destructive priorities.
- [Anthropic](https://www.anthropic.com/): observed readable hierarchy, spacious text and simple button geometry. Applied to inspector explanations and notes, not its cream marketing palette.
- [xAI](https://x.ai/): observed monochrome surfaces and strong primary/secondary action contrast. Applied as restraint, not a copied brand or oversized landing-page layout.
- [Mobbin](https://mobbin.com/): researched as a reference library organized around real screens/flows, including collections/settings/buttons. No subscription purchased, private library inspected or popularity/conversion benchmark inferred.

These are design judgments, not evidence that Pulse users will prefer them. Existing StreamPulse tokens and compact shell remain authoritative. Buttons use static icons, 9px corners, a subtle inset edge and 120ms hover/press feedback. Aurora filled buttons retain the stronger purple on hover to preserve small-text contrast; no ornamental glow, video background or always-running animation.

**Refinement checks:** 27 focused tests, focused TypeScript, preview build, extension build and unchanged content-bundle budget. Chrome verified the inspector at an effective 360px width without horizontal overflow, arrow-key tabs, disabled ReplayForge handoff and Escape restoring focus to the Preview opener. Screenshot capture of the local page timed out; this pass used DOM geometry and interactions, not a new screenshot-based visual certification. Public reference screenshots were inspected successfully. Temporary viewport overrides were reset.

The current preview still uses in-memory storage and is not shipped. New code adds no installed-extension runtime cost until mounted; the demo build's React-inclusive size is not an extension delta. Before mounting, measure the options/content bundle delta independently, add durable persistence and protect account ownership. Package size and runtime library size remain separate concerns.

## Latest refinement: media first, with useful moment statistics

This supersedes the graph-first list design above. The actual settings host and Aurora/Volt/Azure tokens are reused; Library navigation is a proposed section, not a replacement for all current extension settings. No installed-extension screenshot verification is claimed.

- List: historical media availability, exact position, streamer/game, note, one backend-authored comparison, Preview and safe Watch action. Secondary edit/remove actions sit under More.
- Overview: media first, a compact viewers / chat per minute / emotes per minute row, emote density, and three leading emotes. Definitions use disclosures; the graph and its accessible data table stay behind Analysis. This is moment context, not another full analytics dashboard.
- Analysis: the same selected-minute measurements, up to ten emotes, coverage/source caveats and optional supporting chart. No second client scoring engine.
- `MomentPresentation` is an ephemeral projection keyed by moment ID: game-at-moment, authorized historical image URL + sample offset, optional backend-authored signal label/basis, and analysis URL. Validate identities, timestamps, freshness, allowlisted URLs and rights in the production adapter. A safe protocol alone does not establish trust. Do not persist expiring image URLs as bookmark identity.
- `MomentContext` adds nullable `selectedViewers` and optional provider/static-artwork metadata per emote. The production adapter must join stats and emotes to the same canonical stream/minute. Do not mix recap ranking counts from a neighboring minute with inspector counts.
- Usage share means one emote's occurrences divided by **all measured emote occurrences in that same minute**, not just the displayed top three. Invalid/zero/missing denominators yield unavailable, not a fabricated percentage. Density means emote uses per 100 messages and may exceed 100; neither metric measures percentage of viewers engaged or sentiment.
- 7TV is presented alongside other detected providers, not treated as a supporter feature or a guarantee that this snapshot captured every provider. Artwork URLs are restricted to known provider CDNs. Static images load lazily on inspection; errors preserve the readable name, provider and counts. Production still needs the existing worker/BFF metadata resolver, content-security-policy and consent review; no new content-script fetch or third-party credential integration.
- The xQc lead bookmark uses the previous read-only audit's 03:25:21 position and 328 messages / 297 emotes. Viewers, provider attribution, frame and baseline remain unavailable rather than guessed. Its fixture capture date is generated at demo start, not asserted as the original API observation time. `Replay not linked` does not claim Twitch is still processing a video. The portal link is local development only.
- The first History row is a **separate illustrative 7TV example**, with 18,500 viewers / 416 messages / 520 emotes. Its emote counts are invented fixture data, not xQc measurements. Initial failed artwork exercised the readable fallback; the final fixture uses forsenPls, Clap and WAYTOODANK static artwork from the existing catalog, with successful CDN checks. No substitute art is misrepresented as another emote.

Latest verification: **32 focused tests passed**, focused TypeScript passed, preview and extension builds passed, budget passed at 579,846 raw / 166,430 gzip content bytes. The UI remains unmounted, so this does not measure its eventual shipping bundle delta. Chrome verified the updated metrics/emote labels and loaded/fallback artwork. Screenshot capture timed out; responsive and keyboard checks use rendered DOM and interaction evidence, not full visual or WCAG certification. No production VOD fix, storage backend, billing, or ReplayForge integration was made.

## R3: visible card stats, not hidden inspector-only features

User review identified a real presentation failure, not a stale server: the default Bookmarks view contained only unresolved/missing-source examples and did not render any statistics. The populated emote fixture was only discoverable under History → Preview.

R3 fixes the default experience:

- `MomentListItem` accepts `context?: MomentContextState` and renders the reusable `MomentGlance` directly on the card: viewers, chat/min, emotes/min, three emotes with static artwork/provider/occurrences, and concise provenance. Preview remains the place for usage shares, definitions and supporting analysis.
- Unavailable comparison paragraphs are no longer repeated on every row. Valid supplied comparisons remain concise labeled signals; missing sources and statistics still have truthful states.
- The existing host/tokens remain unchanged. Removed the nested list card and repeated Bookmarks heading. `LibraryWorkspace.shellNavigation` lets the host own Storage/help navigation while the content tabs stay Bookmarks/History/Collections; standalone consumers retain all destinations by default.
- New default demo scenario `design` explicitly bookmarks the populated illustrative row. `ready` retains the original audit/edge-case fixtures and semantics tests. The toolbar says **Library preview · R3**, making version and selected example visible at the same URL. Demo changes still reset on refresh.
- No footage is fabricated to make the preview look complete. The visible historical-media placeholder remains until an authorized frame source is provided. This is still the Library subsection, not a reconstruction of every shipped settings destination or supporter appearance feature.

R3 verification: 33 focused tests; focused TypeScript; preview + extension builds; content budget unchanged within limits. Actual in-app-browser screenshots now succeeded and were inspected at desktop and narrow layout (effective 327 CSS px; no page overflow). This supersedes the preceding screenshot-timeout limitation for this pass only. Shipping integration and real media remain separate gates.
