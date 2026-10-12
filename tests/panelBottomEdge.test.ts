import { describe, expect, it } from 'vitest'
import { shadowStyles } from '../src/ui/theme.ts'

/**
 * The bottom of the Pulse panel beside Twitch chat (2026-10-11 polish): a soft
 * edge so a row cut mid-scroll reads as "more below", and a hairline above the
 * pinned Settings bar. Both ship in shadow.css, not the content script.
 */
const rule = (selector: string) => {
  const start = shadowStyles.indexOf(`${selector} {`)
  expect(start, selector).toBeGreaterThan(-1)
  return shadowStyles.slice(start, shadowStyles.indexOf('}', start))
}

describe('panel bottom edge', () => {
  it('fades only the last 10 px of the scroll area, so whole controls never look disabled', () => {
    const body = rule('.placement-sidebar.pulse-sidebar-panel .pulse-panel-body')
    expect(body).toContain('-webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 10px), transparent);')
    expect(body).toContain('mask-image: linear-gradient(to bottom, #000 calc(100% - 10px), transparent);')
    // The body keeps its own 10 px bottom padding (inline), so at the end of the
    // scroll the fade lies over empty space: no padding override here.
    expect(body).not.toContain('padding-bottom')
    expect(body).toContain('overscroll-behavior: contain;')
  })

  it('draws a hairline between the scroll area and the pinned Settings bar', () => {
    const footer = rule('.placement-sidebar.pulse-sidebar-panel .pulse-settings-footer')
    expect(footer).toContain('border-top: 1px solid rgba(255, 255, 255, 0.08);')
    expect(footer).toContain('padding-top: 6px !important;')
  })
})
