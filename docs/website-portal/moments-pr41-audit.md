# Moments PR #41 audit — 2026-09-08

Reviewed candidate: `31465c9`. This is a follow-up to the Moments phone filters and evidence presentation change.

## Findings and corrections

- The initial PR CI failed its dependency audit before build/browser validation. Sharp 0.35.2 in Wrangler's Miniflare dependency chain is affected by GHSA-rgj7-g3m4-5g8c. Pin the transitive dependency to patched 0.35.4; retain the existing severity gate. The local gate then reports no high/critical findings. Two moderate Vitest findings remain.
- Between 521px and 600px, history category controls were hidden while the history filter toggle was also hidden. Align both at 600px and retain full-width history fields. The new 560px browser case exercises expansion, selection, Back, and sorting.
- Custom UTC date fields remained visible after mobile Filters collapsed. Include them in the collapsed surface. The browser test verifies hiding and restoration of the entered date.
- The empty Saved action manually cleared only some query parameters. Reuse the collection-switch operation so stale dates and calendar scope cannot leak into Recent.
- The category geometry test could capture dimensions before route CSS loaded. Wait for the expected cover dimensions before comparing artwork states.

## Scope and evidence limits

Recent remains a ten-item server snapshot. This PR does not add a Recent cursor or deploy stored history. Backend discovery PR #136 remains a separate release dependency.

The filter-panel animation fades/translates content but does not interpolate layout height. Do not describe it as eliminating page movement. Global bucket click-outside handling already exists in FigmaGlobalActivityPanel; ActivityContextRail handles Escape. The focused hub browser cases verify selection and Escape, not every click-outside interaction.

Fixture replay tests establish exact stream/offset mapping, recovery, and browser embedding behavior. They do not establish why the originally reported Pereira7 VOD disappeared, nor guarantee availability of footage on Twitch. That source-specific investigation remains open.

No production deployment or history gate activation was performed in this audit.

## Follow-up verification

- Complete Moments Chromium workflow: 67 passed in one run.
- Two focused global activity selection/Escape browser cases passed.
- Typecheck, production build, and 26 focused route unit tests passed.
- Existing npm audit disposition gate passed; Sharp image encode/decode and Wrangler version smoke passed.
- A read-only hosted lookup at 2026-09-09 02:11 UTC for Pereira7 broadcast `317698418148` returned linked VOD `2868688895`, verified archive-origin timing, alignment -5 seconds, and duration 22,690 seconds. The selected broadcast offset 13,214 maps to VOD offset 13,209. This establishes current mapping availability, not the historical cause of the disappeared preview or actual Twitch playback.
