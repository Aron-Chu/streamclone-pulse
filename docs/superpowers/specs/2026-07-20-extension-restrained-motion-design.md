# Extension Restrained Motion Design

**Status:** Approved

## Goal

Make the StreamPulse extension feel continuous during chart resizing, dock mode changes, route changes, and dropdown use while repairing the narrow Live Now layout and plotted-emote hover states.

## Decision

Use restrained 160-200 ms motion on extension-owned content only. Twitch-owned sidebar geometry remains imperative and unanimated so the extension does not fight Twitch layout measurements or scrolling.

## Behavior

- Activity chart Expand and Reset animate the chart viewport height instead of snapping.
- Compact Live Now metrics remain in one three-column row at narrow sidebar widths.
- Plot on chart shows six emotes initially, reveals another page on demand, and offers Show less after expansion.
- Plotted emote rows and chart legend chips retain their assigned plot color on hover.
- The themed select menu remains anchored while its own options scroll, uses the extension font, and opens with a short fade/translate transition.
- Collapsed, mini, expanded, and channel/VOD/offline content enter with a short opacity/translate transition instead of blinking into place.

## Architecture

Chart resizing uses an owned wrapper with an explicit animated height. Mode and route transitions use CSS entry classes on branch content, while host rectangles in `mount.tsx` remain unchanged. The select menu keeps its Shadow DOM portal and fixed positioning but no longer recalculates placement for every capture-phase nested scroll event.

Plotted rows expose their plot colors through CSS custom properties and a plotted-state class. Hover rules consume those colors rather than replacing them with the generic accent.

## Accessibility And Visual Requirements

- Existing `prefers-reduced-motion` handling must reduce new animation and transition durations.
- Focus indicators and keyboard listbox behavior remain unchanged.
- Motion must not delay interaction or introduce persistent layout shifts.
- Compact metric labels and values must fit without wrapping or overlap.
- Dropdown typography uses the extension font and readable 11 px control text.

## Verification

- Unit coverage proves the six-emote reveal contract and dropdown positioning helpers remain valid.
- Focused UI tests cover any newly extracted transition or route identity helper.
- Full extension tests, TypeScript typecheck, and production build pass.
- Manual verification covers chart expand/reset, plotted hover, dropdown scrolling, dock transitions, and channel/VOD/offline switches.

## Non-goals

- Animating Twitch-owned sidebar host dimensions or page layout.
- Rewriting Overlay mode branches into a new state machine.
- Adding spring physics, large transforms, or decorative motion.
- Changing Pulse data fetching, scoring, or backend contracts.
