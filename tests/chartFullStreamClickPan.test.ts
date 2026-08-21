import { describe, expect, it } from 'vitest'
import { panViewport } from '../src/ui/chartViewport.ts'

describe('FullStreamPanDoesNotInventMovement', () => {
  it('returns the same full-domain viewport when already fully zoomed out', () => {
    const full = { startSeconds: 0, endSeconds: 10_000 }
    const next = panViewport(full, 500, 10_000)
    expect(next).toEqual({ startSeconds: 0, endSeconds: 10_000 })
  })
})
