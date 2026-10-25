// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'

let adShowing: (root?: ParentNode) => boolean

beforeAll(async () => {
  vi.stubGlobal('chrome', { storage: {} })
  ;({ adShowing } = await import('../src/content/momentFrames.ts'))
})

function player(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  return root
}

/**
 * Twitch keeps an empty ax-overlay over every live player, ad or not. Counting
 * it as an ad stopped every capture (QUAL-1 / LIVE-1, 2026-10-17 critique).
 */
describe('Moment pictures ad check', () => {
  it('ignores the empty ad overlay Twitch always renders', () => {
    expect(adShowing(player('<video></video><div data-a-target="ax-overlay"></div>'))).toBe(false)
  })

  it('treats a filled ad overlay as an ad', () => {
    expect(adShowing(player('<div data-a-target="ax-overlay"><div class="ad"></div></div>'))).toBe(true)
  })

  it('still skips frames while the Ad label, countdown or banner shows', () => {
    expect(adShowing(player('<span data-a-target="video-ad-label">Ad</span>'))).toBe(true)
    expect(adShowing(player('<span data-a-target="video-ad-countdown">0:15</span>'))).toBe(true)
    expect(adShowing(player('<p data-test-selector="ad-banner-default-text">Ad</p>'))).toBe(true)
  })
})
