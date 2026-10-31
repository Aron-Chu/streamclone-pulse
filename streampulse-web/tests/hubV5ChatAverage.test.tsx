import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizePublicHub, type HubLiveChannel } from '../src/lib/publicHub'
import { HubV5Busiest } from '../src/ui/components/hub/v5/HubV5Busiest'
import { HubV5Channels } from '../src/ui/components/hub/v5/HubV5Channels'
import { HubV5Rack } from '../src/ui/components/hub/v5/HubV5Rack'
import {
  busiestAria,
  busiestTip,
  channelChat,
  channelRows,
  channelVs,
  channelsTip,
  gameAria,
  hubChatBasis,
  rankBusiest,
  whereChatIs,
  whereChatIsTip,
} from '../src/ui/components/hub/v5/hubV5Model'

afterEach(cleanup)

// HUB-1 (candidate, 10-30): while the 5-minute counts are down, the 30m and 24h replies still carry each row's
// chatPerMin. Backend b1098ac (hub_overview.go summarizeChannelWindow) averages it over a lookback of up to 35
// minutes, minutes with data only and the open unfinished minute included, and the row does not say how many
// minutes that is: a young stream, a collector that just joined, or gaps cover fewer. The lists may rank by it,
// labelled "recent average" with no fixed span (CX-4 fix, 10-30), never mixed with 5-minute values.
const raw = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/hub_screener_down_20261030.json'), 'utf8'))
const down = normalizePublicHub(raw)
const live = down.liveChannels
const nowMs = Date.parse(down.generatedAt)
const row = (login: string) => live.find((c) => c.login === login)!
/** A fixed 35-minute span stated as fact. Only the (i) tips may say "up to the last 35 minutes". */
const FIXED_35 = /\b35[- ]?min(ute)?s?\b/i

/** One row with a full, ready 5-minute window (the healthy screener shape). */
function withFullWindow(c: HubLiveChannel, perMin: number): HubLiveChannel {
  const end = nowMs - 60_000
  return {
    ...c,
    screenerV1: {
      ...c.screenerV1!,
      state: 'ready',
      reason: undefined,
      currentWindow: { start: end - 300_000, end, expectedMinutes: 5, measuredMinutes: 5, coveragePct: 100 },
      chat: { ...c.screenerV1!.chat!, state: 'ready', reason: undefined, currentPerMin: perMin },
    },
  } as HubLiveChannel
}

describe('the chat basis (HUB-1 candidate, 10-30)', () => {
  it('uses the row average only for 30m and 24h while the screener is down', () => {
    expect(hubChatBasis(live, '24h')).toBe('avg_35')
    expect(hubChatBasis(live, '30m')).toBe('avg_35')
    // 7d and longer replies average over 47 minutes or more: no stand-in
    expect(hubChatBasis(live, '7d')).toBe('five_min')
    expect(hubChatBasis(live, '1y')).toBe('five_min')
    expect(hubChatBasis(live)).toBe('five_min')
  })

  it('keeps the 5-minute counts whenever any row has one, so the two never mix', () => {
    const mixed = live.map((c) => (c.login === 'summit1g' ? withFullWindow(c, 12) : c))
    expect(hubChatBasis(mixed, '24h')).toBe('five_min')
    expect(rankBusiest(mixed, 12, hubChatBasis(mixed, '24h')).rows.map((r) => r.login)).toEqual(['summit1g'])
  })

  it('needs a synced row with a chat average', () => {
    expect(hubChatBasis(live.map((c) => ({ ...c, chatPerMin: 0 })), '24h')).toBe('five_min')
  })

  it('has no field saying how many minutes chatPerMin covers, so no copy can name a span (CX-4)', () => {
    // update this, and the copy, if the backend later sends the row's minutes
    const xqc = raw.liveChannels.find((c: { login: string }) => c.login === 'xqc')
    expect(Object.keys(xqc).sort()).toEqual([
      'category', 'chatPerMin', 'coverageState', 'displayName', 'emotesPerMin', 'login',
      'profileImageUrl', 'screener', 'seventvPerMin', 'streamId', 'trendPct', 'viewers',
    ])
    expect(xqc.screener.currentWindow.measuredMinutes).toBe(0)
  })

  it('ends in the outage line, not an average, when no synced row has chat (CX-4)', () => {
    // a failed recent-rollup read with the open-minute read off: every row stats_only with chatPerMin 0
    const empty = live.map((c): HubLiveChannel => ({ ...c, coverageState: 'stats_only', chatPerMin: 0 }))
    expect(hubChatBasis(empty, '24h')).toBe('five_min')
    expect(whereChatIs(empty, 10, '24h').down).toBe(true)
  })
})

describe('the lists on the recent average (HUB-1 candidate, 10-30)', () => {
  it('ranks Busiest now by the row average, synced rows only', () => {
    const set = rankBusiest(live, 12, 'avg_35')
    expect(set.basis).toBe('avg_35')
    expect(set.rows.map((r) => [r.login, r.fig])).toEqual([
      ['yuyuta0702', '373'],
      ['aldo_geo', '336'],
      ['xqc', '244'],
      ['supertf', '65'],
      ['yourragegaming', '53'],
      ['summit1g', '40'],
    ])
    expect(rankBusiest(live).rows).toEqual([])
    // the 5-minute set carries no basis field
    expect(rankBusiest(live).basis).toBeUndefined()
  })

  it('labels the tip and the tile names a recent average, with 35 minutes only as an upper bound', () => {
    const set = rankBusiest(live, 12, 'avg_35')
    const tip = busiestTip(set, 'stale')
    expect(tip.split('\n')[0]).toBe('The 5-minute counts did not load, so this ranks channels by recent average chat per minute: up to the last 35 minutes, counting only minutes with data and the current unfinished minute, so it can cover much less; ties go to more viewers.')
    expect(tip).not.toMatch(/last full 5-minute window|Live means|over the last 35 minutes/)
    expect(tip.split('\n').at(-1)).toBe('Live pictures show only beside the 5-minute counts, so each channel shows its profile picture.')
    expect(busiestAria(set.rows[2]!, set.rows.length)).toBe('xQc, 244 chat messages per minute, recent average, Grand Theft Auto V, rank 3 of 6. Profile picture.')
    expect(busiestAria(set.rows[0]!, set.rows.length)).not.toMatch(FIXED_35)
  })

  it('shares Where chat is out by the row average', () => {
    const games = whereChatIs(live, 10, '24h')
    expect(games.basis).toBe('avg_35')
    expect(games.all.map((g) => g.name)).toEqual(['Just Chatting', 'QSMP', 'Grand Theft Auto V', 'SILENT HILL: townfall'])
    expect(games.counted).toBe(6)
    expect(whereChatIsTip(games)).toContain('The 5-minute counts did not load, so this is each game’s share of recent average chat messages per minute (each channel’s average over up to the last 35 minutes, minutes with data only, so it can cover much less), across the 6 synced channels with a chat average among the 500 biggest live channels we track')
    expect(whereChatIsTip(games)).not.toMatch(/5 closed minutes|over the last 35 minutes/)
    expect(gameAria(games.all[0]!, false, games.basis)).toBe('Just Chatting: 37.1% of chat (recent average), 2 channels. Show these channels in Channels')
    expect(gameAria(games.all[0]!, false)).toBe('Just Chatting: 37.1% of chat, 2 channels. Show these channels in Channels')
    expect(whereChatIs(live, 10, '7d').all).toEqual([])
  })

  it('fills Chat/min with the average and dashes vs own avg', () => {
    expect(channelChat(row('xqc'), 'avg_35')).toBe(243.91)
    expect(channelChat(row('hazlanz'), 'avg_35')).toBeNull()
    expect(channelChat(row('xqc'))).toBeNull()
    expect(channelVs(row('xqc'), 'avg_35')).toEqual({ why: 'comparison unavailable right now' })
    const byChat = channelRows(live, { q: '', game: null, sort: 'chat', dir: -1, basis: 'avg_35' })
    expect(byChat.slice(0, 3).map((c) => c.login)).toEqual(['yuyuta0702', 'aldo_geo', 'xqc'])
    const oneGame = channelRows(live, { q: '', game: 'Just Chatting', sort: 'viewers', dir: -1, basis: 'avg_35' })
    expect(oneGame.map((c) => c.login)).toEqual(['yuyuta0702', 'summit1g'])
    expect(channelsTip(live.length, 1000, 'avg_35')).toBe(
      `Every channel in the live pool (${live.length} of the ~1,000 we follow). The 5-minute counts did not load, so Chat/min is each channel’s recent average: up to the last 35 minutes, counting only minutes with data and the current unfinished minute, so it can cover much less. vs own avg has nothing to compare. `
        + 'A dash means not measured: viewers-only channels have no chat count. Click a channel to open its stream page.',
    )
  })
})

describe('the sections on the recent average (HUB-1 candidate, 10-30)', () => {
  it('Busiest now says recent average and swaps Live for "5-min counts unavailable"', () => {
    const { container } = render(<MemoryRouter><HubV5Busiest live={live} nowMs={nowMs} windowKey="24h" /></MemoryRouter>)
    expect(screen.getByText('Chat messages per minute · recent average')).toBeTruthy()
    expect(screen.getByText('5-min counts unavailable')).toBeTruthy()
    expect(screen.queryByText('Live')).toBeNull()
    expect(screen.queryByText(/last 5 min/)).toBeNull()
    expect(container.textContent).not.toMatch(FIXED_35)
    expect([...container.querySelectorAll('[data-login]')].map((el) => el.getAttribute('data-login'))).toEqual(
      ['yuyuta0702', 'aldo_geo', 'xqc', 'supertf', 'yourragegaming', 'summit1g'],
    )
    // Twitch's live pictures go only beside the 5-minute counts (10-31)
    expect(container.querySelector('.hv5-bzv-prev')).toBeNull()
  })

  it('Busiest now stays empty with the outage line on 7d', () => {
    render(<MemoryRouter><HubV5Busiest live={live} nowMs={nowMs} windowKey="7d" /></MemoryRouter>)
    expect(screen.getByText('Chat counts are unavailable right now.')).toBeTruthy()
  })

  it('Where chat is says recent average', () => {
    const { container } = render(<MemoryRouter><HubV5Rack games={whereChatIs(live, 10, '24h')} game={null} onGame={() => {}} art={new Map()} avatars={new Map()} /></MemoryRouter>)
    expect(screen.getByText('share of chat in the top 500 live channels · recent average')).toBeTruthy()
    expect(screen.queryByText(/last 5 min/)).toBeNull()
    expect(container.textContent).not.toMatch(FIXED_35)
  })

  it('Channels shows the average and says so in the header', () => {
    const { container } = render(<MemoryRouter>
      <HubV5Channels live={live} poolSize={1000} game={null} onClearGame={() => {}} windowKey="24h" />
    </MemoryRouter>)
    expect(screen.getByText('Chat/min = recent average')).toBeTruthy()
    expect(container.textContent).not.toMatch(FIXED_35)
    const cells = (login: string) => [...container.querySelectorAll(`tr[data-login="${login}"] td.r`)].slice(1).map((td) => td.textContent)
    expect(cells('xqc')).toEqual(['244', '—comparison unavailable right now'])
    expect(cells('hazlanz')).toEqual(['—viewers only', '—viewers only'])
  })
})
