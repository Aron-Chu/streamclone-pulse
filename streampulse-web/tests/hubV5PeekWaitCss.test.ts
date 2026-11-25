import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/ui/components/hub/v5/hub-v5.css'), 'utf8')

/** The rules inside every `@media (max-width: 719px)` block, joined. */
const phone = [...css.matchAll(/@media \(max-width: 719px\) \{([^@]*?)\n\}/g)].map(m => m[1]).join('\n')

describe('Top moments today while it waits (U6, 10-28; five rows since H1, 11-19)', () => {
  it('keeps the height of its head and five rows, so they land without a shift', () => {
    // The head is border-box: its 1 px rule and 4 px padding, the 22 px heading, then the 16 px age line on its own
    // line (10-30); each phone row is 52 px and its 1 px rule.
    expect(css).toMatch(/\.hv5-rh \{[^}]*min-height: 40px;[^}]*border-top: 1px[^}]*padding-top: 4px;/)
    expect(css).toMatch(/\.hub-v5 :is\([^)]*\.hv5-tops[^)]*\) :is\(\*, \*::before, \*::after\),[^{]*\{\s*box-sizing: border-box;/)
    expect(css).toMatch(/\n\.hv5-top \.hv5-rh \{ flex: none; flex-wrap: wrap; row-gap: 0; \}/)
    expect(css).toMatch(/\n\.hv5-top \.hv5-rh h2 \{ line-height: 22px; \}/)
    expect(css).toMatch(/\n\.hv5-top \.hv5-rh \.hv5-f2-fresh \{ order: 1; flex-basis: 100%; min-height: 16px;/)
    expect(css).toMatch(/\n\.hv5-f2-fresh \{[^}]*font: 500 12px\/16px/)
    expect(css).toMatch(/\n\.hv5-tm-it \{ border-bottom: 1px solid/)
    expect(phone).toMatch(/\.hub-v5 \.hv5-top \.hv5-tm-row \{ min-height: 52px; \}/)
    expect(phone).toMatch(/\.hv5-tops\[data-wait\] \{ min-height: 308px; \}/)
    expect(1 + 4 + 22 + 16 + 5 * (52 + 1)).toBe(308)
  })

  it('reserves it only while waiting: on phones, and from 720 px', () => {
    const reservations = [...css.matchAll(/([^{}\n]*\.hv5-tops[^{}\n]*)\{[^}]*min-height/g)].map(m => m[1].trim())
    expect(reservations).toEqual(['.hv5-tops[data-wait]', '.hv5-tops[data-wait]', '.hv5-tops[data-wait]'])
    expect(css.split('.hv5-tops[data-wait]')).toHaveLength(4)
    expect(phone).toContain('.hv5-tops[data-wait]')
    // from 720 px each row is 44 px and its 1 px rule
    expect(css).toContain('@media (min-width: 720px) { .hv5-tops[data-wait] { min-height: 268px; } }')
    expect(1 + 4 + 22 + 16 + 5 * (44 + 1)).toBe(268)
    // the peek and the carousel are gone
    expect(css).not.toContain('.hv5-f3-peek')
    expect(css).not.toContain('.hv5-bm-')
  })

  it('under 400 px, where the time takes a line of its own, waits in the taller rows (11-14)', () => {
    const narrow = [...css.matchAll(/@media \(max-width: 399px\) \{([^@]*?)\n\}/g)].map(m => m[1]).join('\n')
    expect(narrow).toMatch(/\.hub-v5 \.hv5-top \.hv5-tm-row \{ flex-wrap: wrap; row-gap: 2px; min-height: 61px; \}/)
    expect(narrow).toMatch(/\.hub-v5 \.hv5-top \.hv5-tm-t \{ flex-basis: 100%; \}/)
    expect(narrow).toMatch(/\.hv5-tops\[data-wait\] \{ min-height: 353px; \}/)
    // each row: 5 px padding, the 34 px name and reason lines, a 2 px gap, the 15 px time, 5 px padding; then its 1 px rule
    expect(5 + 34 + 2 + 15 + 5).toBe(61)
    expect(1 + 4 + 22 + 16 + 5 * (61 + 1)).toBe(353)
  })
})

describe('the hero while the first answer loads', () => {
  it('keeps the Try row as tall as its chips, and the scope line unseen', () => {
    expect(css).toMatch(/\n\.hub-v5 \.hv5-hero-chip \{[^}]*height: 34px;/)
    expect(css).toMatch(/\n\.hv5-hero-try\[data-wait\] \{ min-height: 34px; \}/)
    expect(css).toMatch(/\n\.hv5-scope\[data-wait\] \{ visibility: hidden; \}/)
  })
})

describe('the rail’s head, chips and links (10-30)', () => {
  it('keeps the head and the chips whole in the sticky column from 1536 px when the rows overflow (L1, 11-16)', () => {
    // under 1536 px the rail is a row of its own (B1, 11-11); from 1536 Picking up now alone is the flex column whose rows
    // scroll, never Top moments today, which shares .hv5-top
    const column = css.slice(css.indexOf('@media (min-width: 1536px) {'))
    expect(column).toContain('.hv5-feed.hv5-up { display: flex; flex-direction: column; max-height: calc(100vh - 88px); }')
    expect(css).not.toMatch(/\.hv5-feed\.hv5-top \{ display: flex;/)
    expect(css.split('max-height: calc(100vh - 88px)')).toHaveLength(2)
    expect(css).toMatch(/\n\.hv5-top \.hv5-rh \{ flex: none;/)
    expect(css).toMatch(/\n\.hv5-tm-games \{ flex: none;/)
  })

  it('brings the rail and its rows up under the phone nav, not behind it', () => {
    expect(phone).toMatch(/\.hub-v5 :is\(#latest, \.hv5-tm-it\) \{ scroll-margin-top: 112px; \}/)
  })
})

describe('the Top emotes row while it waits (H1, 11-19)', () => {
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`)
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at))
  }

  it('holds the chips’ height and their 8 px under the head, so the chart under it does not move when they land', () => {
    // the chips: 8 px under the head, 44 px tall, 2 px under them
    expect(rule('.hub-v5 .hv5-emr .hv5-emr-list')).toMatch(/margin-top: 8px;[^}]*padding: 0 0 2px;/)
    expect(rule('.hub-v5 .hv5-emr button.hv5-emr-c')).toMatch(/height: 44px;/)
    // the placeholder and the one line take the same room
    expect(css).toContain('.hv5-emr-wait { height: 44px; margin: 8px 0 2px;')
    expect(css).toMatch(/\.hub-v5 \.hv5-emr \.hv5-emr-q \{[^}]*min-height: 44px; margin: 8px 0 2px;/)
  })

  it('outranks the hub’s list reset, which would drop the chips’ 8 px', () => {
    // the reset is .hub-v5 :is(…, .hv5-emr, …) :is(…, ol, …) { margin: 0 }: two classes and an element
    expect(css).toMatch(/\.hub-v5 :is\([^)]*\.hv5-emr[^)]*\) :is\(h1, h2, h3, p, ol, ul\),[^{]*\{\s*margin: 0;/)
    // three classes win; a lone .hv5-emr-list rule would lose
    expect(css).not.toMatch(/\n\.hv5-emr-list \{/)
  })
})

describe('Busiest now while it waits (F2, 11-19)', () => {
  /** The body of the first `@container <name> (max-width: <w>) {` block, up to its closing line. */
  const block = (head: string) => {
    const at = css.indexOf(`${head} {`)
    return at < 0 ? '' : css.slice(at, css.indexOf('\n}', at))
  }
  const tile = block('@container hv5bzt (max-width: 179.98px)')
  const strip559 = block('@container hv5bzv (max-width: 559px)')

  it('holds the header’s (i) and cue unseen, as the pager’s room is held', () => {
    expect(css).toContain('\n.hv5-bzv-rh [data-wait] { visibility: hidden; }')
    expect(css).toContain('\n.hv5-bzc-pg-wait { visibility: hidden; }')
  })

  it('the strip placeholder is as tall as a tile: the frame’s 4 px padding and −4 px margin add nothing to the flow', () => {
    expect(css).toMatch(/\.hv5-bzs-wait \{\s*height: calc\(\(100cqw - \(var\(--per\) - 1\) \* var\(--gap\)\) \/ var\(--per\) \* 9 \/ 16\);/)
    expect(css).toContain('\n.hv5-bzc-vp { margin: -4px; }')
    expect(css).toMatch(/\.hub-v5 \.hv5-bzc-track \{[^}]*padding: 4px;[^}]*grid-auto-columns: calc\(\(100% - \(var\(--per\) - 1\) \* var\(--gap\)\) \/ var\(--per\)\);/)
  })

  it('on a narrow tile, keeps the caption as tall as it is with the small face while the picture is checked', () => {
    // the narrow tile's caption: 7 px over, the 15 px name, 2 px under; the small face stacks over the name
    expect(tile).toMatch(/\.hv5-bzt-cap \{\s*padding: 7px 6px 2px;/)
    expect(tile).toContain('.hv5-bzt-nm { font-size: 12px; line-height: 15px; }')
    expect(tile).toContain('.hv5-bzt-cap.hf-wait { min-height: calc(var(--hv5-face, 20px) + 24px); align-content: end; }')
    expect(7 + 15 + 2).toBe(24)
    // the face is 20 px, 16 px in a strip under 560 px, and the reserve follows it
    expect(css).toMatch(/\n\.hv5-bzv-av \{[^}]*width: 20px;\s*height: 20px;/)
    expect(strip559).toContain('.hv5-bzv-av { width: 16px; height: 16px; }')
    expect(strip559).toContain('.hv5-bzt-cap { padding: 16px 6px 5px; --hv5-face: 16px; }')
    // only the narrow tile reserves it: a wider caption already holds the face beside the name and category
    expect(css.split('.hv5-bzt-cap.hf-wait')).toHaveLength(2)
  })
})
