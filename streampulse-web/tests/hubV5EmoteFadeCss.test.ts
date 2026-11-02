import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/ui/components/hub/v5/hub-v5.css'), 'utf8')

describe('the Top emotes map fades (10-31)', () => {
  it('fades one layer in and ends with the fade, so nothing finished holds a GPU layer', () => {
    // A both fill kept every finished fade in effect: about 600 tiles and frames each held a layer, which slowed
    // the chart hover beside the map. The keyframe has only a from, so the map looks the same once it ends.
    // Since A and M1 (10-31) the layer that holds the frames and tiles fades, not each one.
    expect(css).toMatch(/\n@keyframes hv5-em-in \{ from \{ opacity: 0; \} \}/)
    const fades = [...css.matchAll(/animation: hv5-em-in ([^;]*);/g)].map(m => m[1])
    expect(fades).toEqual(['0.3s backwards'])
  })

  it('fades out an old layer and a dropped tile, which go once their fade ends', () => {
    expect(css).toMatch(/\n@keyframes hv5-em-out \{ to \{ opacity: 0; \} \}/)
    const outs = [...css.matchAll(/animation: hv5-em-out ([^;]*);/g)].map(m => m[1])
    expect(outs).toEqual(['0.2s ease-out forwards', '0.18s ease-out forwards'])
  })
})
