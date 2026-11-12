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
  channelChatWhy,
  channelVs,
  rankBusiest,
  screenerDown,
  whereChatIs,
} from '../src/ui/components/hub/v5/hubV5Model'

afterEach(cleanup)

// The hub's 24h answer of 2026-10-30 07:19Z with every screener set to history_query_unavailable, trimmed to 8 channels.
const down = normalizePublicHub(JSON.parse(readFileSync(resolve(__dirname, 'fixtures/hub_screener_down_20261030.json'), 'utf8')))
const live = down.liveChannels
const row = (login: string) => live.find((c) => c.login === login)!

/** A row whose screener came back with this reason (the backend's unavailable shape). */
function withReason(c: HubLiveChannel, reason: string): HubLiveChannel {
  const s = c.screenerV1!
  return { ...c, screenerV1: { ...s, reason, chat: { ...s.chat!, reason }, emotes: { ...s.emotes!, reason } } }
}

describe('a screener outage is not "no full 5-minute window" (HUB-3 fix, 10-30)', () => {
  it('is told apart from channels that lack a window', () => {
    expect(live.every((c) => c.screenerV1?.state === 'unavailable')).toBe(true)
    expect(screenerDown(live)).toBe(true)
    expect(screenerDown(live.map((c) => withReason(c, 'history_store_unavailable')))).toBe(true)
    // half the rows is enough; fewer is not
    expect(screenerDown(live.map((c, i) => (i < 4 ? c : withReason(c, 'rollup_unavailable'))))).toBe(true)
    expect(screenerDown(live.map((c, i) => (i < 3 ? c : withReason(c, 'rollup_unavailable'))))).toBe(false)
    expect(screenerDown([])).toBe(false)
  })

  it('keeps the five-minute rule: no row ranks, none is counted', () => {
    expect(rankBusiest(live).rows).toEqual([])
    const games = whereChatIs(live)
    expect(games.all).toEqual([])
    expect(games.down).toBe(true)
  })

  it('names the row’s own reason in the Chat/min and vs own avg dashes', () => {
    expect(channelChatWhy(row('xqc'))).toBe('chat counts unavailable right now')
    expect(channelVs(row('xqc'))).toEqual({ why: 'chat counts unavailable right now' })
    expect(channelChatWhy(withReason(row('xqc'), 'history_store_unavailable'))).toBe('chat counts unavailable right now')
    expect(channelChatWhy(withReason(row('xqc'), 'missing_stream_identity'))).toBe('stream not matched yet')
    expect(channelVs(withReason(row('xqc'), 'stream_identity_unavailable'))).toEqual({ why: 'stream not matched yet' })
    // stats-only and viewer-only rows have no chat count at all
    expect(channelChatWhy(row('hazlanz'))).toBe('viewers only')
    expect(channelVs(row('hazlanz'))).toEqual({ why: 'viewers only' })
  })

  it('keeps "no full 5 minutes yet" for a synced row whose window is short', () => {
    const s = row('xqc').screenerV1!
    const short = { ...row('xqc'), screenerV1: { ...s, state: 'partial', reason: 'current_window_partial', chat: { ...s.chat!, state: 'partial', reason: 'current_window_partial' } } }
    expect(channelChatWhy(short)).toBe('no full 5 minutes yet')
  })

  it('says chat counts are unavailable in Busiest now and Where chat is', () => {
    render(<MemoryRouter>
      <HubV5Busiest live={live} nowMs={Date.parse(down.generatedAt)} />
      <HubV5Rack games={whereChatIs(live)} game={null} onGame={() => {}} art={new Map()} avatars={new Map()} />
    </MemoryRouter>)
    expect(screen.getAllByText('Chat counts are unavailable right now.')).toHaveLength(2)
    expect(screen.queryByText(/full 5-minute window/)).toBeNull()
  })

  it('puts the reason on each Chat/min and vs own avg dash in Channels', () => {
    const { container } = render(<MemoryRouter>
      <HubV5Channels live={live} poolSize={1000} game={null} onClearGame={() => {}} />
    </MemoryRouter>)
    const cells = (login: string) => [...container.querySelectorAll(`tr[data-login="${login}"] td.r`)].slice(1).map((td) => td.textContent)
    expect(cells('xqc')).toEqual(['—chat counts unavailable right now', '—chat counts unavailable right now'])
    expect(cells('hazlanz')).toEqual(['—viewers only', '—viewers only'])
    expect(container.textContent).not.toContain('no full 5 minutes yet')
  })
})
