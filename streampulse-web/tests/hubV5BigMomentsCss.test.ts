import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(resolve(__dirname, '../src/ui/components/hub/v5', file), 'utf8')
const hub = read('hub-v5.css')
const css = read('hub-v5-big-moments.css')

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Each rule's grid-template-areas for exactly this selector, in file order: base, 720, 1100, 1536 px. */
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
      const after = areas(css, mine)
      expect(before).toHaveLength(4)
      expect(after).toHaveLength(4)
      after.forEach((rows, i) => {
        expect(withoutBig(rows)).toEqual(before[i])
        const at = rows.findIndex((r) => r.split(' ').includes('big'))
        expect(rows.filter((r) => r.split(' ').includes('big'))).toHaveLength(1)
        // the next row holds Top emotes; from 1100 px the rail, Top emotes and Games keep sharing theirs
        expect(rows[at + 1]!.split(' ')).toContain('emo')
      })
      const wide = after[2]!
      expect(wide.slice(wide.indexOf('big big big'), wide.indexOf('big big big') + 2)).toEqual(['big big big', 'rail emo games'])
    })
  }

  it('outranks hub-v5.css’s templates whichever file the bundle puts first', () => {
    // (0,3,0) beats the bare grid's (0,2,0); with both rows, (0,4,0) beats the featured stream's (0,3,0)
    expect(css).toContain('.hub-v5.hub-d3:has(> .hv5-big) {')
    expect(css).toContain('.hub-v5.hub-d3:has(> .hv5-most):has(> .hv5-big) {')
    expect(hub).not.toContain('hv5-big')
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
