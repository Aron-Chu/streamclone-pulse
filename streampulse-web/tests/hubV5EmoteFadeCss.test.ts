import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/ui/components/hub/v5/hub-v5.css'), 'utf8')

describe('the Top emotes map fade-in (10-31)', () => {
  it('ends with the fade, so finished tiles and frames hold no GPU layer', () => {
    // A both fill kept every finished fade in effect: about 600 tiles and frames each held a layer, which slowed
    // the chart hover beside the map. The keyframe has only a from, so the tiles look the same once it ends.
    expect(css).toMatch(/\n@keyframes hv5-em-in \{ from \{ opacity: 0; \} \}/)
    const fades = [...css.matchAll(/animation: hv5-em-in ([^;]*);/g)].map(m => m[1])
    expect(fades).toEqual(['0.3s backwards', '0.3s backwards'])
  })
})
