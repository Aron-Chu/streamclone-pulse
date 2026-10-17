import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useState } from 'react'
import { MAX_PLOTTED_EMOTES } from '@streampulse/pulse-charts'
import type { AnalyticsTopEmote } from '../../api.ts'
import { SessionEmotesOnChart } from './SessionEmotesOnChart.tsx'
import { emoteChartColorForKey } from './chartTheme.ts'

afterEach(() => cleanup())

const EMOTES = ['KEKW', 'LUL', 'Pog', 'OMEGALUL', 'monkaS', 'Kappa', 'xdx'].map(
  (name, index) => ({ key: name, name, count: 1000 - index * 100, provider: 'twitch' }) as unknown as AnalyticsTopEmote,
)

function Harness({ initial = [] as string[], topEmotes = EMOTES }: { initial?: string[]; topEmotes?: AnalyticsTopEmote[] }) {
  const [plotted, setPlotted] = useState<string[]>(initial)
  return (
    <div data-testid="plotted" data-keys={plotted.join(',')}>
      <SessionEmotesOnChart
        topEmotes={topEmotes}
        plotted={plotted}
        colorOf={key => emoteChartColorForKey(key, plotted)}
        onToggle={key => setPlotted(list => (list.includes(key) ? list.filter(k => k !== key) : [...list, key]))}
      />
    </div>
  )
}

const keys = () => screen.getByTestId('plotted').getAttribute('data-keys')

describe('SessionEmotesOnChart (d3-v2 session-original Emotes on chart)', () => {
  it('caps the list at six: the rest disable and the limit note shows only at the limit', () => {
    expect(MAX_PLOTTED_EMOTES).toBe(6)
    render(<Harness initial={['KEKW', 'LUL', 'Pog', 'OMEGALUL', 'monkaS']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add emote' }))
    const panel = screen.getByRole('group', { name: 'Emotes on chart' })
    const box = (key: string) => panel.querySelector<HTMLInputElement>(`[data-session-emote="${key}"]`)!
    expect(within(panel).queryByText('Up to 6 at once')).toBeNull()
    expect(box('xdx').disabled).toBe(false)
    fireEvent.click(box('Kappa'))
    expect(keys()).toBe('KEKW,LUL,Pog,OMEGALUL,monkaS,Kappa')
    expect(within(panel).getByText('Up to 6 at once')).toBeTruthy()
    expect(box('xdx').disabled).toBe(true)
    expect(box('KEKW').disabled).toBe(false)
    // a checked row carries its line colour; an unchecked one none
    expect(box('LUL').closest('label')!.style.getPropertyValue('--c')).toBe('#fbbf24')
    expect(box('xdx').closest('label')!.style.getPropertyValue('--c')).toBe('transparent')
    // unticking one frees a slot
    fireEvent.click(box('KEKW'))
    expect(box('xdx').disabled).toBe(false)
    expect(within(panel).queryByText('Up to 6 at once')).toBeNull()
  })

  it('names each plotted emote with a remove button that hands focus to Add emote', () => {
    const { container } = render(<Harness initial={['Pog', 'LUL']} />)
    const tokens = [...container.querySelectorAll('[data-session-emote-token]')]
    expect(tokens.map(t => t.getAttribute('data-session-emote-token'))).toEqual(['Pog', 'LUL'])
    fireEvent.click(screen.getByRole('button', { name: 'Remove Pog from the chart' }))
    expect(keys()).toBe('LUL')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add emote' }))
  })

  it('matches a rollup key to its summary emote by name, as the chart does', () => {
    const topEmotes = [
      { key: 'seventv:9ceb7717:LOL', name: 'LOL', count: 900, provider: 'seventv', imageUrl: 'https://cdn.7tv.app/emote/x/4x.webp' },
      { key: 'seventv:328172f0:LO', name: 'LO', count: 800, provider: 'seventv' },
    ] as unknown as AnalyticsTopEmote[]
    const { container } = render(<Harness initial={['seventv:LOL:LOL']} topEmotes={topEmotes} />)
    const token = container.querySelector('[data-session-emote-token="seventv:LOL:LOL"]')!
    expect(token.textContent).toContain('LOL')
    expect(token.textContent).not.toContain('seventv')
    expect(screen.getByRole('button', { name: 'Remove LOL from the chart' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add emote' }))
    const panel = screen.getByRole('group', { name: 'Emotes on chart' })
    const lol = panel.querySelector<HTMLInputElement>('[data-session-emote="seventv:9ceb7717:LOL"]')!
    const lo = panel.querySelector<HTMLInputElement>('[data-session-emote="seventv:328172f0:LO"]')!
    expect(lol.checked).toBe(true)
    expect(lo.checked).toBe(false)
    // Unticking removes the plotted (rollup) key, not a second copy of the summary key.
    fireEvent.click(lol)
    expect(keys()).toBe('')
    fireEvent.click(lol)
    expect(keys()).toBe('seventv:9ceb7717:LOL')
  })

  it('renders nothing without top emotes or plotted emotes', () => {
    const { container } = render(<Harness topEmotes={[]} />)
    expect(container.querySelector('[data-session-emotes-on-chart]')).toBeNull()
  })
})
