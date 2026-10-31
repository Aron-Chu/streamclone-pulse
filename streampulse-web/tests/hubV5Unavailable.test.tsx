import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { HubV5Busiest } from '../src/ui/components/hub/v5/HubV5Busiest'
import { HubV5Channels } from '../src/ui/components/hub/v5/HubV5Channels'
import { hubClock } from '../src/ui/components/hub/v5/hubV5Model'

afterEach(cleanup)

const cards = (unavailable: boolean) => render(<MemoryRouter>
  <HubV5Busiest live={[]} nowMs={0} unavailable={unavailable} />
  <HubV5Channels live={[]} poolSize={500} unavailable={unavailable} game={null} onClearGame={() => {}} />
</MemoryRouter>)

describe('hub cards while the hub request has failed (INT-02)', () => {
  it('say each card is unavailable right now, with no channel count', () => {
    cards(true)
    expect(screen.getAllByText('Unavailable right now.')).toHaveLength(2)
    expect(screen.queryByText(/ live$/)).toBeNull()
    expect(screen.queryByText('No channels match.')).toBeNull()
  })

  it('keep their own empty lines when the hub answered with nothing', () => {
    cards(false)
    expect(screen.getByText('No synced channel has a full 5-minute window right now.')).toBeTruthy()
    expect(screen.getByText('No channels match.')).toBeTruthy()
    expect(screen.getByText('0 of 500 live')).toBeTruthy()
  })
})

describe('Channels while the first hub reply is loading', () => {
  it('shows no count and no empty line, only the busy table', () => {
    const { container } = render(<MemoryRouter>
      <HubV5Channels live={[]} poolSize={0} loading game={null} onClearGame={() => {}} />
    </MemoryRouter>)
    expect(container.querySelector('[data-hv5-channel-count]')!.textContent).toBe('')
    expect(screen.queryByText('0 of 0 live')).toBeNull()
    expect(screen.queryByText('No channels match.')).toBeNull()
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0)
    expect(container.querySelector('#channels')!.getAttribute('aria-busy')).toBe('true')
  })
})

describe('Channels on a saved copy (S1, 10-28)', () => {
  it('says when its count was live', () => {
    const at = new Date(2026, 9, 28, 10, 50).getTime()
    const { container } = render(<MemoryRouter>
      <HubV5Channels live={[]} poolSize={500} savedAt={at} nowMs={at + 5 * 60_000} game={null} onClearGame={() => {}} />
    </MemoryRouter>)
    expect(container.querySelector('[data-hv5-channel-count]')!.textContent).toBe(`0 of 500 live at ${hubClock(at)}`)
    expect(container.querySelector('[data-hv5-channel-count]')!.textContent).toMatch(/^0 of 500 live at 10:50\sAM$/)
  })

  it('names the day, with no "at", when it was saved on another day', () => {
    const count = (savedAt: number, nowMs: number) => render(<MemoryRouter>
      <HubV5Channels live={[]} poolSize={500} savedAt={savedAt} nowMs={nowMs} game={null} onClearGame={() => {}} />
    </MemoryRouter>).container.querySelector('[data-hv5-channel-count]')!.textContent
    expect(count(new Date(2026, 9, 27, 23, 30).getTime(), new Date(2026, 9, 28, 2, 0).getTime())).toMatch(/^0 of 500 live yesterday, 11:30\sPM$/)
    expect(count(new Date(2026, 9, 26, 21, 5).getTime(), new Date(2026, 9, 28, 9, 0).getTime())).toMatch(/^0 of 500 live Oct 26, 9:05\sPM$/)
  })
})
