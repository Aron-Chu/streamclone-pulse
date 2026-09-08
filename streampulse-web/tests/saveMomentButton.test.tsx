import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fromHubMoment } from '../src/lib/discoveryMoments'

beforeEach(() => { localStorage.clear(); vi.resetModules() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Save confirmation accessibility', () => {
  it.each([false, true])('keeps the live region associated and reserves label space (long=%s)', async longLabel => {
    const { SaveMomentButton } = await import('../src/ui/components/moments/SaveMomentButton')
    const moment = fromHubMoment({ login: 'creator', streamId: 'stream-a', offsetSeconds: 10, label: 'Moment' })!
    render(<SaveMomentButton moment={moment} longLabel={longLabel} />)
    const button = screen.getByRole('button', { name: longLabel ? 'Save on this device' : 'Save' })
    const status = screen.getByRole('status')
    expect(button.getAttribute('aria-describedby')).toBe(status.id)
    expect(status.className).toBe('sr-only')
    expect(status.getAttribute('aria-atomic')).toBe('true')
    expect(screen.getByText(longLabel ? 'Saved on this device' : 'Saved').getAttribute('aria-hidden')).toBe('true')
    fireEvent.click(button)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(status.textContent).toBe('Saved on this device.')
    fireEvent.click(button)
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(status.textContent).toBe('Removed from saved moments.')
  })

  it('announces session-only persistence without claiming a durable save', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Denied', 'QuotaExceededError') })
    const { SaveMomentButton } = await import('../src/ui/components/moments/SaveMomentButton')
    const moment = fromHubMoment({ login: 'creator', streamId: 'stream-a', offsetSeconds: 10, label: 'Moment' })!
    render(<SaveMomentButton moment={moment} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('status').textContent).toBe('Saved for this session only.')
  })
})
