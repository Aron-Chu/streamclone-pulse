import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizePublicHub, type HubMoment } from '../src/lib/publicHub'
import { HubV5Channels } from '../src/ui/components/hub/v5/HubV5Channels'
import { CLIMB_TIP, climbOnScreen, HubV5PickingUp, UP_DOWN, type HubV5PickingUpProps } from '../src/ui/components/hub/v5/HubV5PickingUp'
import { feedClimbing, feedPct, type FeedClimbRow } from '../src/ui/components/hub/v5/hubV5FeedModel'

afterEach(cleanup)

// The hub's 24h answer of 2026-10-30 07:19Z with every screener set to history_query_unavailable (8 channels).
const down = normalizePublicHub(JSON.parse(readFileSync(resolve(__dirname, 'fixtures/hub_screener_down_20261030.json'), 'utf8')))
const at = Date.parse(down.generatedAt)
const MIN = 60_000
const spike = (login: string, magnitude: number, kind: HubMoment['kind'] = 'chat_spike'): HubMoment =>
  ({ kind, login, displayName: login, label: `${login} chat surging`, magnitude, at })
const moments: HubMoment[] = [
  spike('supertf', 93.4),
  { kind: 'live_attach', login: 'summit1g', label: 'summit1g went live', at },
  spike('AlDo_Geo', 216.4, 'emote_spike'),
  spike('nobody_live', 300),
  spike('xqc', 61.1),
  spike('xqc', 80),
  spike('summit1g', 0),
]
const hub = { ...down, moments }

describe('Climbing: the backend’s surge picks while Picking up can’t tell (11-21)', () => {
  it('keeps only chat and emote surges with a live row, once each, biggest rise first', () => {
    const rows = feedClimbing(hub)
    expect(rows.map((x) => [x.login, x.pct])).toEqual([['aldo_geo', 216.4], ['supertf', 93.4], ['xqc', 61.1]])
    const top = rows[0]!
    expect(top.cat).toBe('QSMP')
    expect(top.streamId).toBe(down.liveChannels.find((c) => c.login === 'aldo_geo')!.streamId)
    expect(feedPct(93.4)).toBe('+93%')
    expect(feedClimbing(null)).toEqual([])
    expect(feedClimbing({ liveChannels: down.liveChannels, moments: [] })).toEqual([])
  })

  const topDown = {
    shown: null, up: { up: [], upWindow: '' }, upAsOf: null, upSaved: false, art: new Map<string, string>(), upDown: true,
  } as unknown as HubV5PickingUpProps['top']
  const rail = (rows: readonly FeedClimbRow[], asOf: number | null, nowMs: number, top = topDown) => render(
    <MemoryRouter><HubV5PickingUp top={top} nowMs={nowMs} climbing={{ rows, asOf }} /></MemoryRouter>,
  )

  it('lists them under the "can’t tell" line, live, not greyed with the section', () => {
    const { container } = rail(feedClimbing(hub), at, at + 30_000)
    const aside = container.querySelector('aside')!
    expect(aside.querySelector('[data-up-down]')!.textContent).toBe(UP_DOWN)
    expect(within(aside).getByRole('heading', { level: 3, name: 'Climbing' })).toBeTruthy()
    expect(within(aside).getByRole('button', { name: 'About Climbing' })).toBeTruthy()
    const list = within(aside).getByRole('list', { name: 'Climbing' })
    const links = within(list).getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual([
      expect.stringContaining('aldo_geo, 216% busier than the 5 minutes before, QSMP. Opens the stream page.'),
      expect.stringContaining('supertf, 93% busier than the 5 minutes before, SILENT HILL: townfall. Opens the stream page.'),
      expect.stringContaining('xQc, 61% busier than the 5 minutes before, Grand Theft Auto V. Opens the stream page.'),
    ])
    expect(links[1]!.querySelector('.hv5-f2-x')!.textContent).toBe('+93% busier')
    // the section greys while its counts are down; the climbing picks are live and stay coloured
    expect(aside.classList.contains('hv5-f2-stale')).toBe(true)
    expect(aside.querySelector('.hv5-up-climb-old')).toBeNull()
    expect(CLIMB_TIP).toContain('60%')
  })

  it('greys past 2 minutes and goes once the answer is older than LIVE lasts (15 min)', () => {
    const rows = feedClimbing(hub)
    const { container, unmount } = rail(rows, at, at + 3 * MIN)
    expect(container.querySelector('.hv5-up-climb-old')).not.toBeNull()
    unmount()
    const later = rail(rows, at, at + 16 * MIN)
    expect(later.container.querySelector('[data-up-climb]')).toBeNull()
    expect(later.container.querySelector('[data-up-down]')!.textContent).toBe(UP_DOWN)
  })

  it('stays out while Picking up can tell, and on a saved copy (no answer time)', () => {
    const rows = feedClimbing(hub)
    const counting = { ...topDown, upDown: false, upAsOf: at, shown: { source: 'hub' } } as unknown as HubV5PickingUpProps['top']
    const { container, unmount } = rail(rows, at, at + 30_000, counting)
    expect(container.querySelector('[data-up-climb]')).toBeNull()
    unmount()
    const saved = rail(rows, null, at + 30_000)
    expect(saved.container.querySelector('[data-up-climb]')).toBeNull()
    // Channels marks exactly what the rail lists: nothing beside Picking up's own picks, nothing on a saved copy
    expect(climbOnScreen(topDown, { rows, asOf: at }, at + 30_000)).toBe(rows)
    expect(climbOnScreen(counting, { rows, asOf: at }, at + 30_000)).toEqual([])
    expect(climbOnScreen(topDown, { rows, asOf: null }, at + 30_000)).toEqual([])
    expect(climbOnScreen(topDown, { rows, asOf: at }, at + 16 * MIN)).toEqual([])
  })

  it('marks the climbing channels in Channels and bars chat/min against the list’s highest', () => {
    render(
      <MemoryRouter>
        <HubV5Channels live={down.liveChannels} poolSize={500} game={null} onClearGame={() => {}} windowKey="24h" climbing={feedClimbing(hub)} />
      </MemoryRouter>,
    )
    const row = (login: string) => document.querySelector(`tr[data-login="${login}"]`)!
    expect(row('supertf').querySelector('.hv5-ch5-up')!.textContent).toBe('+93%')
    expect(within(row('supertf') as HTMLElement).getByRole('link').textContent).toContain('93% busier than the 5 minutes before')
    expect(row('summit1g').querySelector('.hv5-ch5-up')).toBeNull()
    // the busiest chat/min fills its bar; the rest are measured against it
    const width = (login: string) => parseFloat((row(login).querySelector('.hv5-ch5-bar i') as HTMLElement).style.width)
    expect(width('yuyuta0702')).toBe(100)
    expect(width('summit1g')).toBe(Number(((39.85 / 372.5) * 100).toFixed(1)))
    // a row with no chat count keeps its dash and no bar
    expect(row('hazlanz').querySelector('.hv5-ch5-bar')).toBeNull()
    // the game's cover sits beside its name; the name is still the cell's words
    expect(row('xqc').querySelector('.c-gm .hv5-tm-gm')).not.toBeNull()
    expect(row('xqc').querySelector('.c-gm .hv5-ch5-gn')!.textContent).toBe('Grand Theft Auto V')
    expect(screen.getByRole('heading', { name: 'Channels' })).toBeTruthy()
  })
})
