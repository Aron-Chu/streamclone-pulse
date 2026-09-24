# Analytics and Moments interaction audit — 2026-09-08

Scope: the active portal hub, exact-stream console, and Moments Recent,
Sessions, Saved, review, and indexed-history views. Existing working-tree work
was preserved. This is local implementation and browser evidence, not a deployment.

## Changes and evidence

| Surface | Finding / resulting behavior | Verification |
| --- | --- | --- |
| Moments first load | A single loading line became a full grid abruptly. Six card-shaped placeholders now reserve space; the result count says Loading instead of implying zero. Existing results remain during refresh. | `moments-loading-motion.spec.ts`: held network response, placeholder removal, `aria-busy`, actual animation calls. |
| Recent, Sessions, Saved and history results | New identities receive a 220ms, 6px entrance without fading interactive text, with a maximum 120ms stagger. At most 12 elements animate in a batch. Identity memory is bounded to 1,000. Enrichment, polls and filter returns do not replay arrivals. | `collectionArrival.test.tsx`, loading browser tests, existing Moments workflows. |
| Detection cards | Creator identity precedes evidence. Rates and comparisons appear once when a reaction visual already contains them. Source state remains visible. The duplicate recent-feed scope paragraph was removed; the ten-result limitation remains above filters. | Existing selection, source-state, image, navigation and responsive Moments workflows. |
| Category browsing | Unfamiliar categories now use exact-broadcast games metadata, with ID/CDN validation, ambiguous-ID rejection, two concurrent reads, eight streams per view and a bounded cache. Existing explicit or rejected metadata is not overwritten. | Category enrichment/sanitization tests; live browser showed the previously missing Special Events artwork. |
| Selected moment | Short entrance, consistent focus, existing bounded scrolling and source actions retained. Motion does not change selection or scroll ownership. | `moment-detail-scroll.spec.ts` at 390/1370/1920px; exact-source and navigation workflows. |
| Hottest Live | Supplied channel/stream identities use the shared bounded arrival treatment, rather than replaying on every poll. Existing shelf scrolling and keyboard controls remain. | Arrival unit coverage and existing hub shelf audit. |
| Global Activity / matching moments | Compact selection summary, stable hover, viewer scaling, meaningful bucket errors and restored reaction imagery from the preceding work remain. Filter controls now match the quieter shared style. | `analytics-interaction-refinement.spec.ts`, hub audit and bucket recovery tests. |
| Live Wire | Existing follow-newest, interaction holds, independent chart selection, source failure and recovery retained. Shared focus styling added without a second arrival engine. | Live Wire unit tests and polling browser test. |
| Emote Market | Real tab/panel associations and roving keyboard focus added. Left/Right/Home/End select views. Content transitions are 180ms and polls do not remount the active view. | Emote Market unit tests and keyboard browser test. |
| Channels table | Membership changes incorrectly reset pagination. Polls now preserve the page, clamping only when it no longer exists. User filter/search/order changes still reset pagination. | `liveChannelsMatrixSingleTree.test.tsx` membership and shrink cases; single-tree browser checks. |
| Exact-stream console | Uppercase heavy controls and a white selected button diverged from the hub. Sentence-case controls, teal selection, visible keyboard focus, and reduced-motion skeleton handling now align with the portal. | Live browser inspection; `analytics-console-refinement.spec.ts` at 390/768/1440/1920px. |
| Archive and Saved states | Inspected availability, retry, storage failure, return navigation and loaded-scope behavior. Existing truthful unavailable states and exact source identity are retained. | `discovery-calendar.spec.ts`, `moments-workflow.spec.ts`. |

All motion remains progressive enhancement: readable final content is the base
state. Reduced-motion changes cancel active arrivals. No artificial network delay,
fabricated preview, new scoring logic or background replay lookup was introduced.

## Validation

- Portal production build, app/test typechecks, analytics overlap check and narrow
  whitespace checks pass.
- 78 focused frontend tests pass across eleven files.
- The broad production-preview workflow run passed 53/55 initially. The removed
  duplicate-copy expectation was updated and its complete workflow passes. The
  remaining legacy hosted-console test assumes equal-width rails and older
  selectors; it is not evidence for the current responsive console contract.
- New deterministic console checks pass at four widths. The loading/reduced-motion,
  scrolling, keyboard, hover, polling and result-list checks pass.
- The final production-preview workflow suite passes all 58 tests, covering
  Moments workflows, indexed-calendar states, discovery interactions, the single
  responsive channel table, collection arrivals and the current session controls.
- The hub visual baseline was visually reviewed and refreshed for the intentional
  control and layout changes. The existing public audit also contains the known
  unrelated landing assertion for absent `details.sl-optional-demo`.

## Data limits exposed by the audit

Recent reads the public hub's ten-moment sample. Its occurrence filter does not
fetch or rank historical moments. The hosted 24-hour newsroom API returned 15
broadcast summaries during inspection; that is session history, not a global
moment ranking. `/v1/public/discovery` returned 404. Historical discovery and
hosted lifecycle availability need backend release work; no deployment was
performed. Categories with missing metadata now try bounded exact-stream artwork
enrichment; unavailable or conflicting category identity receives a neutral fallback.

The separate `mockups/moments-workspace.html` remains a design study, not a second
mounted product UI. The refinement above applies to the existing canonical stack.
