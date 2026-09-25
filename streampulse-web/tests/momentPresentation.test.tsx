import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MomentSelect } from '../src/ui/components/moments/MomentSelect'
import { MomentEvidenceBars } from '../src/ui/components/moments/MomentEvidenceBars'
import { SessionMomentMap } from '../src/ui/components/moments/SessionMomentMap'
import type { DiscoveryMoment } from '../src/lib/discoveryMoments'
import { isMomentsFeedUnavailable, resolveMomentAvatarUrl } from '../src/routes/analytics/AnalyticsMomentsPage'

afterEach(cleanup)
describe('session reaction timestamps', () => {
  it('opens the exact timestamp and refuses to combine different streams', () => {
    const first = { key: 'first', login: 'creator', streamId: 'one', offsetSeconds: 60, label: 'Chat spike' } as DiscoveryMoment
    const second = { ...first, key: 'second', offsetSeconds: 180 }
    const select = vi.fn()
    const { rerender } = render(<SessionMomentMap moments={[second, first]} onSelect={select} />)
    fireEvent.click(screen.getByRole('button', { name: '3:00' }))
    expect(select).toHaveBeenCalledWith(second)
    rerender(<SessionMomentMap moments={[first, { ...second, streamId: 'another' }]} onSelect={select} />)
    expect(screen.queryByRole('region')).toBeNull()
  })
})
describe('moment avatar URL safety', () => {
  it('rejects arbitrary image URLs and preserves only the Twitch CDN allowlist', () => {
    expect(resolveMomentAvatarUrl('https://evil.example/avatar.png')).toBeUndefined()
    expect(resolveMomentAvatarUrl('javascript:alert(1)')).toBeUndefined()
    expect(resolveMomentAvatarUrl('https://static-cdn.jtvnw.net/jtv_user_pictures/example.png')).toBe(
      'https://static-cdn.jtvnw.net/jtv_user_pictures/example.png',
    )
  })
})
describe('moments feed availability', () => {
  it('does not turn aggregate-only stats fallback into a legitimate empty feed', () => {
    expect(isMomentsFeedUnavailable('recent', 'stats-fallback', false)).toBe(true)
    expect(isMomentsFeedUnavailable('recent', 'full', true)).toBe(false)
    expect(isMomentsFeedUnavailable('recent', 'cache', true)).toBe(false)
    expect(isMomentsFeedUnavailable('saved', 'stats-fallback', false)).toBe(false)
  })
})
describe('moment filter menu', () => {
  it('skips disabled options, selects with the keyboard and returns focus', () => {
    Element.prototype.scrollIntoView = vi.fn()
    const change = vi.fn()
    render(<MomentSelect aria-label="Range" value="live" onValueChange={change}>
      <option value="live">Recent</option><option value="24h" disabled>24 hours</option><option value="7d">7 days</option>
    </MomentSelect>)
    const trigger = screen.getByRole('combobox', { name: 'Range' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const list = screen.getByRole('listbox')
    fireEvent.click(screen.getByRole('option', { name: '24 hours' }))
    expect(change).not.toHaveBeenCalled()
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(change).toHaveBeenCalledWith('7d')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
  it('supports typeahead and Escape without changing the selection', () => {
    const change = vi.fn()
    render(<MomentSelect aria-label="Category" value="a" onValueChange={change}>
      <option value="a">All</option><option value="m">Minecraft</option>
    </MomentSelect>)
    fireEvent.click(screen.getByRole('combobox'))
    const list = screen.getByRole('listbox')
    fireEvent.keyDown(list, { key: 'm' })
    expect(list.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Minecraft' }).id)
    fireEvent.keyDown(list, { key: 'Escape' })
    expect(change).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
describe('measured comparison bars', () => {
  it('retains a measured zero and refuses to draw a ratio against it', () => {
    const moment = { comparison: { chat: { state: 'ready', baselinePerMin: 100, currentPerMin: 200 }, emotes: { state: 'new_activity', baselinePerMin: 0, currentPerMin: 20 } } } as DiscoveryMoment
    const { container } = render(<MomentEvidenceBars moment={moment} />)
    expect(screen.getByText('2.0× earlier average')).toBeTruthy()
    expect(screen.getByText('new activity')).toBeTruthy()
    expect(screen.getByText(/No earlier emotes was measured/)).toBeTruthy()
    // The measured zero is still stated as the earlier rate.
    expect(container.querySelector('.moment-ratio__head span')?.textContent).toContain('0')
    // One log track for the one drawable ratio, at 2× on a 1×–10× scale.
    expect([...container.querySelectorAll<HTMLElement>('.moment-ratio__track i')].map(bar => bar.style.width))
      .toEqual(['30.1%'])
    expect([...container.querySelectorAll('.moment-ratio__tick')].map(tick => tick.textContent)).toEqual(['1×', '10×'])
  })
  it('keeps a huge spike on the same readable scale as a small one', () => {
    const moment = { comparison: { chat: { state: 'ready', baselinePerMin: 21.93, currentPerMin: 308, multiplier: 14.04 }, emotes: { state: 'ready', baselinePerMin: 11.21, currentPerMin: 2570, multiplier: 229.26 } } } as DiscoveryMoment
    const { container } = render(<MomentEvidenceBars moment={moment} />)
    const widths = [...container.querySelectorAll<HTMLElement>('.moment-ratio__track i')].map(bar => Number.parseFloat(bar.style.width))
    // Shared 1×–1000× scale: the bigger multiplier draws longer, and neither pins to the end.
    expect(widths[0]).toBeCloseTo((Math.log10(14.04) / 3) * 100, 1)
    expect(widths[1]).toBeCloseTo((Math.log10(229.26) / 3) * 100, 1)
    expect(widths[0]).toBeLessThan(widths[1])
    expect(widths[1]).toBeLessThan(100)
    expect([...container.querySelectorAll('.moment-ratio__tick')].map(tick => tick.textContent))
      .toEqual(['1×', '10×', '100×', '1000×', '1×', '10×', '100×', '1000×'])
  })
  it('reports the baseline coverage that makes the ratio trustworthy', () => {
    const moment = { comparison: { chat: { state: 'ready', baselinePerMin: 21.93, currentPerMin: 308, multiplier: 14.04 },
      evidence: { baselineMeasuredMinutes: 1019, baselineExpectedMinutes: 1022 } } } as unknown as DiscoveryMoment
    render(<MomentEvidenceBars moment={moment} />)
    expect(screen.getByText(/Measured 1,019 of 1,022 earlier minutes/)).toBeTruthy()
  })
  it('does not draw an invented baseline or an unready comparison', () => {
    const moment = { comparison: { chat: { state: 'partial', baselinePerMin: 100, currentPerMin: 200 }, emotes: { state: 'ready', currentPerMin: 20 } } } as DiscoveryMoment
    const { container } = render(<MomentEvidenceBars moment={moment} />)
    expect(container.innerHTML).toBe('')
  })
})
