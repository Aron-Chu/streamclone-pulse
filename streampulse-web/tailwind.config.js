/** @type {import('tailwindcss').Config} */

/**
 * Embedded workspace packages that emit Tailwind class names for the analytics console.
 * When adding a new file: dependency under @streampulse/* used inside .sc-analytics-console,
 * add its src glob here AND run `npm run check:analytics-tailwind`.
 *
 * SVG paint (fill-*) also needs explicit fallbacks in src/ui/analytics-tailwind.css —
 * Tailwind content scan alone is not enough for <text> labels on dark charts.
 */
export default {  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../../streampulse-backend/packages/analytics-console/src/**/*.{js,ts,jsx,tsx}',
    // pulse-charts owns PulseMultiSignalChart SVG axis labels (fill-cyan-*, fill-zinc-*, …)
    '../../streampulse-backend/packages/pulse-charts/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {},
  },
  safelist: [
    'text-emerald-300',
    'bg-emerald-500/15',
    'border-emerald-500/25',
    'text-violet-300',
    'bg-violet-500/15',
    'border-violet-500/25',
    'text-sky-300',
    'bg-sky-500/15',
    'border-sky-500/25',
    'text-amber-300',
    'bg-amber-500/15',
    'border-amber-500/25',
    'text-zinc-400',
    'bg-white/[0.06]',
    'border-white/10',
  ],
  // The portal ships its own hand-written CSS (hub.css, landing.css, figma-*).
  // Tailwind is only used by the embedded analytics console, so we disable the
  // global preflight reset and scope the equivalent base rules to the console
  // wrapper instead (see ui/analytics-tailwind.css). This keeps Tailwind
  // utilities available without clobbering the rest of the site.
  corePlugins: {
    preflight: false,
  },
  plugins: [],
}
