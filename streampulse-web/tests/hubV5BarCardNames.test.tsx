/**
 * Pick 12A (10-30): an open bar card's named emotes must not turn into "none
 * named in this bucket" when a later hub reply carries the same minute without
 * names.
 *
 * Shapes are the 07:18Z bucket of two saved hub replies (10-30): the 30m reply
 * sends it with 10 named emotes; the 24h reply (live_pool_fallback) sends the
 * same minute, 1,511 emote uses, bucketComplete, and no topEmotes. The portal
 * swaps between those replies, so the card said chat named no emotes. It now
 * says the names are not in this update; "none named" stays for zero emotes.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { HubActivityPoint } from '../src/lib/publicHub'
import { resetHubBucketSelectionForTests, selectHubBucket } from '../src/lib/hubBucketSelection'
import { HubV5BarCard } from '../src/ui/components/hub/v5/HubV5BarCard'

const T = Date.parse('2026-10-30T07:18:00Z')

const base = {
  t: T,
  providerCountsComplete: true,
  hasChatRollup: true,
  hasViewerRollup: true,
  bucketComplete: true,
}

/** The 30m reply, 07:18Z (first three of its ten named emotes). */
const named: HubActivityPoint = {
  ...base,
  chat: 5689,
  emotes: 1669,
  seventv: 503,
  twitch: 1141,
  bttv: 13,
  ffz: 12,
  viewers: 638306,
  topEmotes: [
    { name: 'renrHype2', provider: 'twitch', count: 151 },
    { name: 'torihu2Blackheart', provider: 'twitch', count: 125 },
    { name: 'LUL', provider: 'twitch', count: 76 },
  ],
}

/** The 24h reply (live_pool_fallback), 07:18Z: measured uses, no names sent. */
const unnamed: HubActivityPoint = {
  ...base,
  chat: 5092,
  emotes: 1511,
  seventv: 435,
  twitch: 1052,
  bttv: 12,
  ffz: 12,
  viewers: 495509,
}

/** A minute that counted chat and zero emotes. */
const noEmotes: HubActivityPoint = {
  ...base,
  chat: 840,
  emotes: 0,
  seventv: 0,
  viewers: 495509,
}

function card(points: HubActivityPoint[]) {
  return (
    <MemoryRouter>
      <HubV5BarCard points={points} bucketMinutes={1} moments={[]} />
    </MemoryRouter>
  )
}

const select = () => act(() => selectHubBucket({ t: T, endT: T + 60_000, barMinutes: 1, source: 'bar' }))
const emoteLine = () => document.querySelector('[data-hub-bar-card] .hbk-emo .hbk-sl')!.textContent

afterEach(() => {
  cleanup()
  resetHubBucketSelectionForTests()
})

describe('HubV5BarCard top emote names across hub replies (pick 12A)', () => {
  it('says the names are not in this update when a later reply counted emotes but sent no names', () => {
    const view = render(card([named]))
    select()
    expect(screen.getByText('renrHype2')).toBeTruthy()

    // The later reply (24h live-pool fallback) for the same open card.
    view.rerender(card([unnamed]))

    // Still the same open card on the same minute, now from the poorer reply.
    expect(document.querySelector('[data-hub-bar-card]')).not.toBeNull()
    expect(screen.getByText('1,511')).toBeTruthy()
    expect(screen.queryByText('none named in this bucket')).toBeNull()
    expect(emoteLine()).toBe('Top emotesnames not in this update')
  })

  it('keeps "none named in this bucket" for a bar that counted zero emotes', () => {
    render(card([noEmotes]))
    select()
    expect(document.querySelector('[data-hub-bar-card]')).not.toBeNull()
    expect(screen.queryByText('names not in this update')).toBeNull()
    expect(emoteLine()).toBe('Top emotesnone named in this bucket')
  })
})
