import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { HubActivityRhythmLines } from '../src/ui/components/analytics/HubActivityRhythmLines'

describe('HubActivityRhythmLines', () => {
  it('renders both lines when both are present', () => {
    const { container } = render(
      <svg>
        <HubActivityRhythmLines height={100} avg={20} loud={70} />
      </svg>,
    )
    expect(container.querySelectorAll('line.hx-rhythm-line')).toHaveLength(2)
  })

  it('renders only the avg line when loud is null', () => {
    const { container } = render(
      <svg>
        <HubActivityRhythmLines height={100} avg={20} loud={null} />
      </svg>,
    )
    expect(container.querySelectorAll('line.hx-rhythm-line')).toHaveLength(1)
    expect(container.querySelector('.hx-rhythm-line--loud')).toBeNull()
  })

  it('renders nothing when avg is null', () => {
    const { container } = render(
      <svg>
        <HubActivityRhythmLines height={100} avg={null} loud={null} />
      </svg>,
    )
    expect(container.querySelectorAll('line.hx-rhythm-line')).toHaveLength(0)
  })

  it('attaches a presentation role and a <desc> with line labels', () => {
    const { container } = render(
      <svg>
        <HubActivityRhythmLines height={100} avg={20} loud={70} />
      </svg>,
    )
    expect(container.querySelector('g')?.getAttribute('role')).toBe('presentation')
    expect(container.querySelector('desc')?.textContent).toContain('avg')
  })
})