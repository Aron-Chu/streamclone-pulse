# Extension Smart Surface Theme Design

**Status:** Approved architecture

**Goal:** Make the Pulse tab follow Twitch's light or dark surface theme by
default, while offering persistent `Auto`, `Light`, and `Dark` overrides without
changing the existing Aurora, Volt, and Azure accent choices.

## Decision

Use semantic surface tokens plus host-local CSS variables.

The alternatives were rejected:

- A CSS override layer cannot reliably replace the many inline React colors.
- Passing a theme prop through the component tree adds broad prop plumbing and
  React rerenders for a host-level concern.

The chosen design keeps color-scheme detection in the Twitch content layer,
surface palettes in the UI layer, and persistence in shared storage.

## Behavior

| Preference | Twitch state | Resolved Pulse scheme |
|------------|--------------|-----------------------|
| `auto` | `.tw-root--theme-light` | `light` |
| `auto` | `.tw-root--theme-dark` | `dark` |
| `auto` | unknown or transient | `dark` |
| `light` | any | `light` |
| `dark` | any | `dark` |

`auto` is the default. Twitch theme changes update both Pulse Shadow DOM hosts
without remounting React or resetting panel state.

The color-scheme preference is independent from the existing accent preference:

```text
surface scheme: Auto | Light | Dark
accent palette: Aurora | Volt | Azure
```

## Architecture

```text
html.tw-root--theme-light / html.tw-root--theme-dark
                         |
                         v
              detectTwitchColorScheme()
                         |
                  preference resolver
                         |
          +--------------+--------------+
          |                             |
          v                             v
  #streamclone-pulse-tabs      #streamclone-pulse-root
    host CSS variables           host CSS variables
          |                             |
          +--------------+--------------+
                         v
              both isolated shadow trees
```

### Storage contract

Add a new sync-storage key, `colorSchemePreference`, with type:

```ts
export type ColorSchemePreference = 'auto' | 'light' | 'dark'
```

Invalid or legacy values normalize to `auto`. Do not overload
`themePreference`; that key remains the accent palette contract.

### Twitch detection

Create a testable content helper that:

1. Checks `document.documentElement.classList` for
   `tw-root--theme-light` and `tw-root--theme-dark`.
2. Uses dark when neither class is available, preserving the current first
   paint and avoiding a light flash during Twitch hydration.
3. Observes only the root element's `class` attribute.
4. Emits only when the resolved value changes.
5. Returns an idempotent cleanup function.

Do not observe the full Twitch subtree for theme changes.

### Surface palette

Create a surface palette separate from accent colors. It owns semantic values
for canvas, panel, elevated panel, glass panel, primary/secondary/muted text,
border, subtle border, neutral hover/fill, chart background/grid/crosshair,
input background, shadow, and focus ring contrast.

Set these as namespaced `--pulse-surface-*` variables on each extension host,
not on Twitch's document root. Keep `--pulse-accent-*` behavior unchanged.

`src/ui/theme.ts` continues to expose the existing `theme` object, but surface
members become `var(...)` references with current dark values as fallbacks.
This lets existing inline style objects inherit the resolved palette without
component props.

Hard-coded neutral black/white surfaces in `theme.ts`, `Overlay.tsx`, chart
components, dock components, and select/menu styles must migrate to semantic
surface variables. Semantic signal colors for live, warning, error, chat,
emotes, viewers, rankings, and selected moments remain stable unless contrast
tests prove a scheme-specific adjustment is required.

### Mount lifecycle

`mount.tsx` owns the current preference, Twitch-resolved scheme, observer
cleanup, and application to both hosts. It must:

- apply a dark palette before the first React render;
- hydrate the stored preference asynchronously;
- react to storage changes from any extension surface;
- react to Twitch root-class changes when preference is `auto`;
- clean up the observer on unmount;
- never recreate a Shadow Root only to change theme.

### Settings UI

Add `Auto`, `Light`, and `Dark` to the existing Appearance section. Use a
segmented control with `aria-pressed`, a visible focus ring, and an explanatory
hint for Auto. Retain the accent selector as a separate field.

### Charts and portals

Chart neutral colors move to surface variables. Data-series colors remain
fixed for legend parity.

Menus opened from the Shadow DOM must portal into the existing Pulse portal
root rather than `document.body`, so Twitch CSS cannot style them and host-local
surface variables continue to inherit.

## Accessibility and visual requirements

- Primary, secondary, and muted text token pairs meet WCAG AA for their rendered
  sizes in both schemes.
- All interactive controls have visible `:focus-visible` treatment.
- Theme and accent segmented controls expose selected state with
  `aria-pressed`.
- No control, chart label, or menu overflows at 240, 280, 320, and 392 pixel
  sidebar widths.
- Light mode is a true light surface palette, not an inverted dark screenshot.
- Reduced-motion behavior remains unchanged.

## Verification

Unit coverage must include storage normalization, Twitch class detection,
observer deduplication/cleanup, preference resolution, and palette application.

Mocked extension E2E coverage must include:

- Auto on Twitch light and dark fixtures;
- a live Twitch class switch without navigation or remount;
- Light and Dark overrides resisting Twitch class changes;
- persistence after service-worker restart;
- sidebar tabs/body plus right, mini, and collapsed modes;
- keyboard focus and no horizontal overflow;
- screenshots for dark and light at desktop and narrow sidebar sizes.

After any source edit, run `npm test`, `npm run typecheck`, and the mandatory
`npm run build`. Run focused Playwright theme/lifecycle specs before completion.

## Non-goals

- Rebranding accent palettes.
- Changing Pulse scoring or backend contracts.
- Using Twitch localStorage as the source of truth.
- Applying styles to Twitch-owned elements.
- Making popup/options auto-detect the currently open Twitch tab.
- Restoring removed product features as part of the theme patch.
