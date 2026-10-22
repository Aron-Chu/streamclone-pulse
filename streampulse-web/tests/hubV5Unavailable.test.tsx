import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { HubV5Busiest } from '../src/ui/components/hub/v5/HubV5Busiest'
import { HubV5Channels } from '../src/ui/components/hub/v5/HubV5Channels'

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
