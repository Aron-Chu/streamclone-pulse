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
    streamId: 'stream-1',
    vodId: 'vod-1',
    source: 'live_irc',
    topEmoteCode: 'KEKW',
    topEmotes: [{ id: '01H7TVEMOTEIDENTITY01', name: 'KEKW', provider: '7tv', count: 12 }],
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
    expect(within(row).getByRole('link', { name: /KEKW on 7TV/i }).getAttribute('href')).toBe(
      'https://7tv.app/emotes/01H7TVEMOTEIDENTITY01',
    )
    expect(within(row).getByRole('link', { name: '2:00' }).getAttribute('href')).toBe(
      '/analytics/moments?view=recent&login=xqc&stream=stream-1&offset=120',
    )
    expect(container.querySelector('a[href*="twitch.tv/videos"]')).toBeNull()
    expect(within(row).getByText('Chat spike').closest('td')?.getAttribute('data-label')).toBe('Moment')
    expect(within(row).getByText('—', { selector: '[data-label="Chat/min"]' })).toBeTruthy()
  })

  it('selects the row without intercepting its independent destination links', () => {
    const onSelect = vi.fn()
    renderPulseLive(onSelect)
    expect(screen.getByRole('heading', { name: /Pulse Moments/i })).toBeTruthy()
    expect(screen.getByText(/1 moment/i)).toBeTruthy()
    expect(screen.queryByText(/Live IRC/i)).toBeNull()
    const row = screen.getByRole('row', { name: /Chat spike/i })
    fireEvent.click(row)
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(moments[0])
    onSelect.mockClear()
    fireEvent.click(within(row).getByRole('link', { name: /xQc/i }))
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(within(row).getByRole('link', { name: /KEKW on 7TV/i }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it.each(['pulse-live', 'default'] as const)('preserves nested-link keyboard actions in %s rows', (variant) => {
    const onSelect = vi.fn()
    render(<MemoryRouter><MostReactedMinutesTable moments={moments} variant={variant} onSelect={onSelect} /></MemoryRouter>)
    const row = screen.getByRole('row', { name: /Chat spike/i })
    for (const key of ['Enter', ' ']) {
      fireEvent.keyDown(row, { key })
      expect(onSelect).toHaveBeenCalledExactlyOnceWith(moments[0])
      onSelect.mockClear()
      for (const link of within(row).getAllByRole('link')) {
        expect(fireEvent.keyDown(link, { key })).toBe(true)
        expect(onSelect).not.toHaveBeenCalled()
      }
    }
  })

  it('selects the hub inspector through the time button', () => {
    const onSelect = vi.fn()
    renderPulseLive(onSelect)
    const row = screen.getByRole('row', { name: /Chat spike/i })
    fireEvent.click(within(row).getByRole('link', { name: '2:00' }))
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
