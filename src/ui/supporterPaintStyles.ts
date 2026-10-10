import { SUPPORTER_TENURES, supporterCrestCssUrl } from '../shared/supporterPaint.ts'

/**
 * Stylesheet for Supporter paint and crests.
 *
 * Everything that moves lives here as CSS so the size-gated content script only
 * carries a class and a few data attributes. The finish sets the paint's
 * colours, `data-wave` its pattern, and `data-sheen` the light that crosses it.
 * The sheen draws on a copy of the text (`data-text`), so a drifting wave and a
 * sweeping light never fight over the same background position. The copy has
 * empty alt text, so screen readers announce the title once.
 */
export function supporterPaintCss(): string {
  const crests = SUPPORTER_TENURES.map(({ id }) => `.pulse-crest[data-tenure="${id}"]{background-image:${supporterCrestCssUrl(id)}}`).join('\n')
  return `
  .pulse-crest { background: center / contain no-repeat; display: inline-block; flex: none; height: 20px; width: 20px; }
  ${crests}
  .pulse-paint {
    --pulse-paint-base: #78dce8; --pulse-paint-lift: #a5b4fc; --pulse-paint-deep: #2fa4b8; --pulse-paint-core: #e3f8fb;
    -webkit-background-clip: text;
    background-clip: text;
    background-image: linear-gradient(100deg, var(--pulse-paint-base), var(--pulse-paint-lift) 40%, var(--pulse-paint-base) 68%, var(--pulse-paint-deep));
    color: transparent !important;
    position: relative;
    -webkit-text-fill-color: transparent;
  }
  .pulse-paint[data-finish="etched"] { --pulse-paint-base: #efc96a; --pulse-paint-lift: #fff1c2; --pulse-paint-deep: #a87420; --pulse-paint-core: #fdf4dc; }
  .pulse-paint[data-finish="halo"] { --pulse-paint-base: #e6a9d6; --pulse-paint-lift: #c4b5fd; --pulse-paint-deep: #fcb69f; --pulse-paint-core: #fbeaf6; }
  .pulse-paint[data-wave="ripple"] { background-image: repeating-linear-gradient(100deg, var(--pulse-paint-base) 0, var(--pulse-paint-lift) 0.16em, var(--pulse-paint-deep) 0.34em, var(--pulse-paint-base) 0.5em); }
  .pulse-paint[data-wave="chrome"] { background-image: linear-gradient(180deg, var(--pulse-paint-core) 0%, var(--pulse-paint-base) 47%, var(--pulse-paint-deep) 53%, var(--pulse-paint-lift) 100%); }
  .pulse-paint[data-wave="aurora"] {
    animation: pulse-paint-drift 9s ease-in-out infinite alternate;
    background-image: linear-gradient(90deg, var(--pulse-paint-base), var(--pulse-paint-lift), var(--pulse-paint-deep), var(--pulse-paint-lift), var(--pulse-paint-base));
    background-size: 300% 100%;
  }
  .pulse-paint::after {
    animation: pulse-paint-sweep 6s ease-in-out infinite;
    -webkit-background-clip: text;
    background-clip: text;
    background-image: linear-gradient(100deg, transparent 40%, rgba(255, 255, 255, 0.9) 50%, transparent 60%);
    background-position: 150% 0;
    background-repeat: no-repeat;
    background-size: 250% 100%;
    color: transparent;
    content: attr(data-text) / "";
    inset: 0;
    pointer-events: none;
    position: absolute;
    -webkit-text-fill-color: transparent;
  }
  .pulse-paint[data-sheen="glint"]::after { animation: pulse-paint-glint 9s ease-out infinite; }
  .pulse-paint[data-sheen="pulse"]::after { animation: pulse-paint-beat 3s ease-in-out infinite; background-color: rgba(255, 255, 255, 0.6); background-image: none; opacity: 0; }
  .pulse-paint[data-sheen="none"]::after { display: none; }
  @keyframes pulse-paint-drift { from { background-position: 0% 0; } to { background-position: 100% 0; } }
  @keyframes pulse-paint-sweep { 0% { background-position: 150% 0; } 35%, 100% { background-position: -50% 0; } }
  @keyframes pulse-paint-glint { 0% { background-position: 150% 0; } 8%, 100% { background-position: -50% 0; } }
  @keyframes pulse-paint-beat { 0%, 60%, 100% { opacity: 0; } 12% { opacity: 0.55; } 30% { opacity: 0; } 42% { opacity: 0.35; } }

  @media (prefers-reduced-motion: reduce) {
    .pulse-paint, .pulse-paint::after, .pulse-crest { animation: none !important; }
  }
`
}
