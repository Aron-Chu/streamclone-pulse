---
description: Run the Design Reviewer agent against StreamPulse /analytics. Read-only audit.
mode: agent
agent: design-reviewer
---

# Design Review — StreamPulse /analytics

Perform a read-only design and UX review of the StreamPulse `/analytics`
portal.

## Inputs

- **Application route:** `http://127.0.0.1:5174/analytics` (or
  `https://streampulse.stream/analytics` if the dev server is not
  running)
- **Primary user goal:** Understand pulse moments activity for the
  broadcaster the user is signed in as — viewer activity, emote
  activity, live wire, and how they relate in time
- **Figma reference:** none (or paste URL)
- **Relevant Storybook:** none — read components directly from
  `streampulse-web/src/ui/`

## Steps

1. Inspect the repository's existing components, tokens, typography,
   layout conventions, and responsive patterns in
   `streampulse-web/src/ui/`. Use Figma and Storybook tools when
   available. Do **not** assume a component or prop exists without
   verifying it.
2. Start the application with the `run-streampulse-web` skill if the
   dev server is not running.
3. Review the actual rendered interface using browser tools. Test at
   approximately 1440px desktop, 1024px tablet, and 390px mobile.
4. Inspect the normal, loading, empty, error, populated, hover,
   keyboard-focus, and overflow states that are reasonably reachable.
   Pay attention to:
   - Reduced-motion emulation
   - Press-drag horizontal scrubbing at 390px
   - Keyboard navigation (Arrow ±1, Shift+Arrow ±5, Home/End)
5. Evaluate visual hierarchy, spacing, alignment, typography, content
   density, responsive behavior, component consistency, accessibility,
   interaction clarity, console errors, broken assets, and obvious
   layout shifts.

## Constraints

- **Read-only.** Do **not** modify any files yet.
- **Truthfulness.** Distinguish "more data is available" from "we
  don't know." Distinguish preview from selected in the inspector
  rail. Live Wire must read as fresh chart annotation, not as a
  second Moments list.
- **No new components.** Recommend reuse of
  `streampulse-web/src/ui/` first.

## Deliverable (evidence-based report)

1. Overall design assessment
2. Five highest-impact issues
3. Findings ranked by severity (blocker, high, medium, low, polish)
4. For each: route, viewport, state, affected component, evidence,
   user impact, recommended correction
5. Existing components that should be reused
6. Screenshots or browser evidence where useful
7. Ordered implementation plan

Clearly distinguish verified defects from subjective polish suggestions.
Wait for approval before implementing changes.
