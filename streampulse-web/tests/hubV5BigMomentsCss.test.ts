import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(resolve(__dirname, '../src/ui/components/hub/v5', file), 'utf8')
const hub = read('hub-v5.css')
const css = read('hub-v5-big-moments.css')

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Each rule's grid-template-areas for exactly this selector, in file order: phones, from 720 px (B1, 11-11: desktop takes the phone's order),
    from 1200 px (A1 pairs) and from 1536 px (L1, 11-16: Picking up now is the right column). */
const areas = (source: string, selector: string) =>
  [...source.matchAll(new RegExp(`(?:^|\\n)\\s*${esc(selector)} \\{[^}]*?grid-template-areas: ([^;]+);`, 'g'))].map((m) => [...m[1]!.matchAll(/"([^"]+)"/g)].map((r) => r[1]!))
const withoutBig = (rows: string[]) => rows.filter((r) => !r.split(' ').includes('big'))

describe('Chat’s big moments in the hub’s grid (C1, 11-01)', () => {
  for (const [name, theirs, mine] of [
    ['without the featured stream', '.hub-v5.hub-d3', '.hub-v5.hub-d3:has(> .hv5-big)'],
    ['with the featured stream', '.hub-v5.hub-d3:has(> .hv5-most)', '.hub-v5.hub-d3:has(> .hv5-most):has(> .hv5-big)'],
  ] as const) {
    it(`adds only its row above Top emotes at every width, ${name}`, () => {
      const before = areas(hub, theirs)
      const all = areas(css, mine)
      // the third is the A1 pairing from 1200 px and the fourth the right column from 1536 px, checked below
      const after = all.slice(0, 2)
      expect(before).toHaveLength(4)
      expect(all).toHaveLength(4)
      after.forEach((rows, i) => {
        expect(withoutBig(rows)).toEqual(before[i])
        const at = rows.findIndex((r) => r.split(' ').includes('big'))
        expect(rows.filter((r) => r.split(' ').includes('big'))).toHaveLength(1)
        // the next row holds Top emotes, right after Picking up now as on phones; from 720 px Where chat is shares it
        expect(rows[at - 1]!.split(' ')).toContain('rail')
        expect(rows[at + 1]!.split(' ')).toContain('emo')
      })
      const wide = after[1]!
      expect(wide.slice(wide.indexOf('big big'), wide.indexOf('big big') + 2)).toEqual(['big big', 'emo games'])
      // from 1440 px Picking up now and Chat's big moments share a row; every other row keeps its place
      const paired = all[2]!
      expect(paired).toContain('rail big')
      expect(paired).toContain('peek busy')
      expect(paired.filter((r) => r !== 'rail big' && r !== 'peek busy')).toEqual(wide.filter((r) => !['big big', 'rail rail', 'peek peek', 'busy busy'].includes(r)))
      // from 1536 px Picking up now is the right column (L1, 11-16), so Chat's big moments spans the main column under the
      // chart, above Top emotes; every other row is hub-v5.css's
      const column = all[3]!
      const big = column.indexOf('big big rail')
      expect(column.filter((r) => r !== 'big big rail')).toEqual(before[3])
      expect(column[big - 1]).toBe('intv intv rail')
      expect(column[big + 1]).toBe('emo games rail')
    })
  }

  it('outranks hub-v5.css’s templates whichever file the bundle puts first', () => {
    // (0,3,0) beats the bare grid's (0,2,0); with both rows, (0,4,0) beats the featured stream's (0,3,0)
    expect(css).toContain('.hub-v5.hub-d3:has(> .hv5-big) {')
    expect(css).toContain('.hub-v5.hub-d3:has(> .hv5-most):has(> .hv5-big) {')
    expect(hub).not.toContain('hv5-big')
  })
})

describe('Picking up now’s column from 1536 px (L1, 11-16)', () => {
  it('runs from Busiest now down in a 380 px third column, and stays in view while the page scrolls', () => {
    for (const selector of ['.hub-v5.hub-d3', '.hub-v5.hub-d3:has(> .hv5-most)']) {
      const rows = areas(hub, selector)[3]!
      const at = rows.indexOf('peek busy rail')
      expect(rows.slice(0, at)).toEqual(['mast mast mast', 'fol fol fol'])
      expect(rows.slice(at).every((r) => r.endsWith(' rail') && r.split(' ').length === 3)).toBe(true)
    }
    const column = hub.slice(hub.indexOf('@media (min-width: 1536px) {'))
    expect(column).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 380px;')
    expect(column).toContain('.hv5-latest { position: sticky; top: 72px; align-self: start; margin-top: 12px; }')
    expect(column).toContain('.hv5-feed.hv5-up { display: flex; flex-direction: column; max-height: calc(100vh - 88px); }')
  })
})

describe('Chat’s big moments’ look', () => {
  it('has no text under 12 px', () => {
    const sizes = [...css.matchAll(/font-size: ([\d.]+)px/g)].map((m) => Number(m[1]))
    expect(sizes.length).toBeGreaterThan(5)
    expect(sizes.filter((px) => px < 12)).toEqual([])
    expect(css).not.toMatch(/font: [^;]*\b(?:[0-9]|1[01])(?:\.\d+)?px/)
  })

  it('times each card with the front dot’s fill, which every hold pauses', () => {
    expect(css).toContain('.hv5-bm-dots button[aria-current="true"] .hv5-bm-fill { animation-name: hv5-bm-clock; animation-duration: 6000ms; animation-timing-function: linear; animation-fill-mode: forwards; }')
    expect(css).toContain('.hv5-bm[data-paused] .hv5-bm-fill { animation-play-state: paused; }')
    expect(css).toMatch(/@keyframes hv5-bm-clock \{ to \{ transform: scaleX\(1\); \} \}/)
    // The shorthand sets the play state back to running, and (0,3,1) beats the hold's (0,3,0): in the browser the
    // clock ran on through every pause (11-01)
    expect(css).not.toMatch(/\banimation:/)
  })

  it('keeps the emotes and the actions at the card’s foot, past the base margin reset', () => {
    // .hub-v5 .hv5-big :is(h2, p, ul) is (0,2,1), so a bare .hv5-bm-em lost its auto margin (11-01)
    expect(css).toContain('.hub-v5 .hv5-big :is(h2, p, ul) { margin: 0; }')
    expect(css).toContain('.hub-v5 .hv5-big .hv5-bm-em { margin-top: auto; }')
  })

  it('fades cards instead of sliding them with reduced motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.hv5-bm-card \{ transition: opacity 0\.2s; \}\s*\}/)
  })
})
