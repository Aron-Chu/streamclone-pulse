// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { SUPPORTER_CREST_GEMS, SUPPORTER_CREST_PULSE_PATH, SUPPORTER_TENURES, type SupporterTenure } from '../src/shared/supporterPaint.ts'
import { FINISHES, kitCrest, type KitFinish } from '../src/supporter/kit.ts'

/**
 * The crest is built with createElementNS, not parsed from a string through
 * innerHTML (Firefox's add-on lint warns on innerHTML). It must draw exactly
 * what the old markup string drew.
 */
function legacyCrestMarkup(tenure: SupporterTenure, size: number, finish: KitFinish | null): string {
  const g = SUPPORTER_CREST_GEMS[tenure]
  const edge = finish ? FINISHES[finish].c : g.edge
  return `<svg width="${size}" height="${size}" viewBox="0 0 18 18" aria-hidden="true"><polygon points="${g.points}" fill="#08080a" stroke="${edge}" stroke-width="1.5" stroke-linejoin="round"/>${g.crown ? `<path d="${g.crown}" fill="none" stroke="#ffe8a6" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round"/>` : ''}<path d="${g.rank}" fill="none" stroke="${g.edge}" stroke-width="1.5" stroke-linecap="round"/><path d="${SUPPORTER_CREST_PULSE_PATH}" fill="none" stroke="#fff" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/></svg>`
}

const finishes: Array<KitFinish | null> = [null, ...(Object.keys(FINISHES) as KitFinish[])]

describe('kitCrest', () => {
  it.each(SUPPORTER_TENURES.flatMap(({ id }) => finishes.map(finish => [id, finish] as const)))(
    'draws the same SVG as the old markup (%s, finish %s)',
    (tenure, finish) => {
      const crest = kitCrest({ name: 'sample', finish, tenure: 'new' }, 14, tenure)
      const legacy = document.createElement('span')
      legacy.innerHTML = legacyCrestMarkup(tenure, 14, finish)

      expect(crest.className).toBe('spk-crest')
      expect(crest.dataset.tenure).toBe(tenure)
      const svg = crest.firstElementChild!
      expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg')
      expect(svg.isEqualNode(legacy.firstElementChild)).toBe(true)
      expect(crest.innerHTML).toBe(legacy.innerHTML)
    },
  )
})
