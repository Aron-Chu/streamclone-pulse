import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { HubActivityMomentAnnotations } from '../src/ui/components/analytics/HubActivityMomentAnnotations'
import type { HubChartAnnotation } from '../src/lib/hubChartMarkers'

const spike: HubChartAnnotation = {
  key: 'a',
  bucketT: 0,
  kind: 'spike',
  channelName: 'Fanum',
  source: 'network',
  xPercent: 50,
}
const moment: HubChartAnnotation = {
  key: 'b',
  bucketT: 60_000,
  kind: 'moment',
  channelName: 'Arky',
  source: 'network',
  xPercent: 80,
}

describe('HubActivityMomentAnnotations', () => {
  it('renders a spike glow (3 ellipses) for spike-classified annotations', () => {
    const { container } = render(
      <svg>
        <HubActivityMomentAnnotations annotations={[spike]} height={100} reducedMotion />
      </svg>,
    )
    expect(container.querySelectorAll('ellipse.hx-spike-glow')).toHaveLength(3)
  })

  it('renders a stamp for non-spike annotations', () => {
    const { container } = render(
      <svg>
        <HubActivityMomentAnnotations annotations={[moment]} height={100} reducedMotion />
      </svg>,
    )
    expect(container.querySelectorAll('rect.hx-moment-stamp')).toHaveLength(1)
    expect(container.querySelector('.hx-moment-stamp__connector')).toBeTruthy()
  })

  it('dims and omits the label of an annotation marked labelOmitted', () => {
    const dimmed: HubChartAnnotation = { ...moment, opacity: 0.4, labelOmitted: true }
    const { container } = render(
      <svg>
        <HubActivityMomentAnnotations annotations={[dimmed]} height={100} reducedMotion />
      </svg>,
    )
    const stamp = container.querySelector('rect.hx-moment-stamp')
    expect(stamp?.getAttribute('opacity')).toBe('0.4')
    expect(container.querySelector('text.hx-moment-stamp__label')).toBeNull()
  })

  it('skips the spike glow pulse when reducedMotion is true', () => {
    const { container } = render(
      <svg>
        <HubActivityMomentAnnotations annotations={[spike]} height={100} reducedMotion />
      </svg>,
    )
    expect(container.querySelector('.hx-spike-glow--pulse')).toBeNull()
  })
})