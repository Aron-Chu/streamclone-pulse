import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MomentContextSpans } from '../src/ui/components/analytics/FigmaMomentInspector'
import { ROLLUP_CONFIDENCE_TITLE } from '../src/lib/pulseMomentsUtils'

describe('MomentContextSpans', () => {
  it('attaches confidence tooltip only to the confidence segment', () => {
    const { container } = render(
      <MomentContextSpans
        moment={{
          offsetSeconds: 60,
          score: 90,
          label: 'Chat spike',
          source: 'live_irc',
          confidence: 97,
          vodState: 'vod_ready',
        }}
      />,
    )

    const confidence = container.querySelector('.pulse-moments__context-confidence[title]')
    expect(confidence).toBeTruthy()
    expect(confidence?.getAttribute('title')).toBe(ROLLUP_CONFIDENCE_TITLE)
    expect(container.textContent).toContain('Live IRC')
    expect(container.textContent).toContain('VOD ready')
    const sourceSpan = container.querySelector('.pulse-moments__context-spans > span:first-child')
    expect(sourceSpan?.getAttribute('title')).toBeNull()
  })
})
