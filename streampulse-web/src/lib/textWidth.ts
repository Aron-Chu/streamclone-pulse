/**
 * A label's width from an offscreen canvas, so fitting labels never forces a layout of the page (S1, 11-19: the emote
 * map's per-label getBoundingClientRect cost about 480 ms on a phone). Null where there is no OffscreenCanvas (jsdom,
 * old Safari): the caller measures the DOM instead.
 */
let context: OffscreenCanvasRenderingContext2D | null | undefined

export function measureTextWidth(text: string, font: string): number | null {
  if (context === undefined) {
    try {
      context = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d')
    } catch {
      context = null
    }
  }
  if (!context) return null
  context.font = font
  return context.measureText(text).width
}
