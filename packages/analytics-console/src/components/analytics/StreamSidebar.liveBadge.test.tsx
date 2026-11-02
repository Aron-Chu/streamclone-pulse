import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { AnalyticsStream } from '../../apiTypes.ts'
import { StreamSidebar } from './StreamSidebar.tsx'

afterEach(() => cleanup())

// One badge rule: the live row says LIVE; the open row follows the page's own verdict,
// so a page that says "Streamed Oct 29 · 4h" never sits beside a LIVE row, and a page
// that says "Live now" never sits beside a Synced one (L1, 11-02).
const row = (over: Partial<AnalyticsStream> = {}) => ({
  streamId: '316700000001',
  login: 'xqc',
  title: 'Stream',
  category: 'Just Chatting',
  startedAt: '2026-10-29T18:00:00Z',
  peakViewers: 12_000,
  ...over,
}) as AnalyticsStream

function renderSidebar(props: { stream: AnalyticsStream; activeLive?: boolean; liveState?: string; liveStreamId?: string }) {
  return render(
    <MemoryRouter>
      <StreamSidebar
        login="xqc"
        streams={[props.stream]}
        isLiveView={false}
        activeID={props.stream.streamId}
        activeLive={props.activeLive}
        liveState={props.liveState}
        liveStreamId={props.liveStreamId}
        buildSessionPath={(login, id) => `/analytics/${login}/${id}`}
        buildChannelPath={login => `/analytics/${login}`}
      />
    </MemoryRouter>,
  )
}

describe('stream list LIVE badge', () => {
  it('the open row of an ended stream never says LIVE, whatever the row data says', () => {
    renderSidebar({ stream: row({ lifecycleState: 'confirmed_live' }), activeLive: false, liveState: 'live', liveStreamId: '316700000001' })
    expect(document.querySelector('[data-stream-row-live]')).toBeNull()
  })

  it('L1: the open row of a live stream says LIVE, not its sync badge, with no live answer naming it', () => {
    renderSidebar({ stream: row(), activeLive: true })
    expect(document.querySelector('[data-stream-row-live]')?.textContent).toBe('Live')
    expect(document.body.textContent).not.toMatch(/Synced|Partial|Stats only/)
  })

  it('a live answer naming another row marks that row only', () => {
    renderSidebar({ stream: row(), liveState: 'live', liveStreamId: '316700000999' })
    expect(document.querySelector('[data-stream-row-live]')).toBeNull()
  })

  it('without the page verdict the row rule applies: the live answer naming this row', () => {
    renderSidebar({ stream: row(), liveState: 'live', liveStreamId: '316700000001' })
    expect(document.querySelector('[data-stream-row-live]')).not.toBeNull()
  })
})
