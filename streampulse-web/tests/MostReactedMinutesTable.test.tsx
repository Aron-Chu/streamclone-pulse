import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { MostReactedMinutesTable } from '../src/ui/components/analytics/MostReactedMinutesTable'
import type { FigmaMomentRow } from '../src/lib/figmaSessionAnalytics'

const moments: FigmaMomentRow[] = [
  {
    offsetSeconds: 120,
    score: 88,
    label: 'Chat spike',
    login: 'xqc',
    displayName: 'xQc',
    vodId: 'vod-1',
    source: 'live_irc',
    topEmoteCode: 'KEKW',
    topEmotes: [{ name: 'KEKW', provider: '7tv', count: 12 }],
  },
]

function renderPulseLive(onSelect = vi.fn()) {
  const view = render(
    <MemoryRouter>
      <MostReactedMinutesTable
        moments={moments}
        variant="pulse-live"
        selectedKey="xqc::120"
        onSelect={onSelect}
        channel={{ login: 'xqc', displayName: 'xQc' }}
        liveLogins={new Set(['xqc'])}
      />
    </MemoryRouter>,
  )
  return { ...view, onSelect }
}

describe('MostReactedMinutesTable pulse-live rows', () => {
  it('uses semantic table rows without wrapping links in a button', () => {
    const { container } = renderPulseLive()
    const row = screen.getByRole('row', { name: /Chat spike/i })
    expect(row.tagName).toBe('TR')
    expect(container.querySelector('button.pulse-moments__leaderboard-row')).toBeNull()
    expect(within(row).getByRole('link', { name: /xQc/i })).toBeTruthy()
    expect(within(row).getByRole('link', { name: /KEKW on 7TV/i })).toBeTruthy()
    expect(within(row).getByRole('link', { name: '2:00' })).toBeTruthy()
    expect(within(row).getByText('Chat spike').closest('td')?.getAttribute('data-label')).toBe('Moment')
    expect(within(row).getByText('—', { selector: '[data-label="Chat/min"]' })).toBeTruthy()
  })

  it('selects row on container click and keyboard', () => {
    const onSelect = vi.fn()
    renderPulseLive(onSelect)
    expect(screen.getByRole('heading', { name: /Pulse Moments/i })).toBeTruthy()
    expect(screen.getByText(/1 moment/i)).toBeTruthy()
    expect(screen.queryByText(/Live IRC/i)).toBeNull()
    const row = screen.getByRole('row', { name: /Chat spike/i })
    fireEvent.click(row)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ offsetSeconds: 120 }))
    onSelect.mockClear()
    row.focus()
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ offsetSeconds: 120 }))
  })

  it('shows game under channel when category is present', () => {
    const withGame: FigmaMomentRow[] = [
      {
        ...moments[0],
        category: 'Just Chatting',
      },
    ]
    render(
      <MemoryRouter>
        <MostReactedMinutesTable
          moments={withGame}
          variant="pulse-live"
          selectedKey="xqc::120"
          onSelect={vi.fn()}
          channel={{ login: 'xqc', displayName: 'xQc' }}
          liveLogins={new Set(['xqc'])}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Just Chatting')).toBeTruthy()
  })
})
