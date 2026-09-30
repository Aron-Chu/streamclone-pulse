import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MomentHandoffActions } from '../src/ui/components/analytics/MomentHandoffActions'

const moment = { login: 'XQC', streamId: 'stream-exact', offsetSeconds: 60, label: 'Chat spike' }

describe('MomentHandoffActions', () => {
  it('copies the canonical moment URL and announces success only after copying', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<MomentHandoffActions moment={moment} />)
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Copy moment link' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Moment link copied'))
    expect(writeText).toHaveBeenCalledWith('https://streampulse.stream/analytics/xqc/stream-exact#t=60')
  })

  it('keeps the canonical link available when clipboard permission is denied', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard denied'))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<MomentHandoffActions moment={moment} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy moment link' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(
      'Copy this link: https://streampulse.stream/analytics/xqc/stream-exact#t=60',
    ))
  })

  it('does not offer a fabricated link without an exact stream identity', () => {
    render(<MomentHandoffActions moment={{ ...moment, streamId: '' }} />)
    expect(screen.queryByRole('button', { name: 'Copy moment link' })).toBeNull()
  })
})
