import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveryMoment } from '../src/lib/discoveryMoments'
import { MomentEmotes, MomentRow } from '../src/ui/components/moments/MomentRow'
import { MomentRowPicture } from '../src/ui/components/moments/MomentPreview'
import { resetMomentReads } from '../src/lib/momentReads'
import { momentAtKey, momentMinuteAt } from '../src/lib/momentFeedback'
import { emoteDisplaySrc, emoteSrcSet } from '../src/lib/emoteAssetUrl'

// A list row 30 s into the 10:40 UTC minute.
const moment: DiscoveryMoment = {
  key: '9000001:2430',
  login: 'fakechan01',
  displayName: 'FakeChan01',
  streamId: '9000001',
  offsetSeconds: 2430,
  at: Date.parse('2026-11-14T10:40:30Z'),
  label: 'Chat spike',
  category: 'fake-pog',
  provenance: 'hub',
}

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetMomentReads() })

function showRow(row: DiscoveryMoment = moment) {
  let state: unknown
  function Page() { state = useLocation().state; return <p>moment page</p> }
  render(
    <MemoryRouter initialEntries={['/analytics/moments']}>
      <Routes>
        <Route path="/analytics/moments" element={<MomentRow moment={row} selected={false} onSelect={() => {}} />} />
        <Route path="/analytics/moments/:streamId/:momentAt" element={<Page />} />
      </Routes>
    </MemoryRouter>,
  )
  return { state: () => state }
}

const pageLink = () => screen.queryByRole('link', { name: /^Moment page for FakeChan01 at / })

describe('a list row and its Moment page', () => {
  it('offers no Moment page link while the page is switched off, and keeps its other actions', () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', '')
    showRow()
    expect(pageLink()).toBeNull()
    expect(screen.getByRole('link', { name: 'View stream timeline' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Stream analytics for FakeChan01/ })).toBeTruthy()
  })

  it('links the row’s own minute and hands the Moment over once switched on', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', 'on')
    const view = showRow()
    const link = pageLink()!
    expect(link.textContent).toBe('Moment page')
    expect(link.getAttribute('href')).toBe('/analytics/moments/9000001/20261114T1040Z')
    fireEvent.click(link)
    await screen.findByText('moment page')
    expect(view.state()).toMatchObject({ from: 'moments', moment: { streamId: '9000001', momentAt: '20261114T1040Z', offsetSeconds: 2430, login: 'fakechan01', displayName: 'FakeChan01', category: 'fake-pog' } })
  })

  it('links the Moment’s own minute when its stream started on a fractional second, as Up next does', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', 'on')
    // Started 12:00:30.4; the 12:01 Moment is 29 s in, so its `at` is 12:00:59.4.
    const start = Date.parse('2026-11-14T12:00:30.400Z')
    const key = momentAtKey(momentMinuteAt(start, 29))
    expect(key).toBe(momentAtKey(Date.parse('2026-11-14T12:01:00Z')))
    const view = showRow({ ...moment, offsetSeconds: 29, at: start + 29_000 })
    const link = pageLink()!
    expect(link.getAttribute('href')).toBe(`/analytics/moments/9000001/${key}`)
    fireEvent.click(link)
    await screen.findByText('moment page')
    expect(view.state()).toMatchObject({ from: 'moments', moment: { momentAt: key, offsetSeconds: 29 } })
  })

  it.each([
    ['a stream id that is not digits', { ...moment, streamId: 'stream-1' }],
    ['no time', { ...moment, at: undefined }],
  ])('offers no Moment page link for %s', (_name, row) => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', 'on')
    showRow(row)
    expect(pageLink()).toBeNull()
  })

  it('keeps the picture slot, with a blank label and nothing for a screen reader, before any picture is read', () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', '')
    const { container } = render(<MemoryRouter><MomentRow moment={moment} selected={false} onSelect={() => {}} /></MemoryRouter>)
    const slot = container.querySelector('.moments-card-slot')
    expect(slot?.getAttribute('data-preview')).toBe('none')
    expect(slot?.getAttribute('aria-hidden')).toBe('true')
    expect(slot?.querySelector('.moments-card-pic img')).toBeNull()
    expect(slot?.querySelector('.moments-card-label')?.textContent).toBe('')
  })

  /** Rows read once near the screen: a stand-in observer, and a stream answer with no VOD (nothing more to read). */
  const nearRows = () => {
    const watched: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = []
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { watched.push(callback) }
      observe() {}
      disconnect() {}
    })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ channel: 'fakechan01', stream: { streamId: '9000001', channel: 'fakechan01' } })))
    return () => act(() => { watched.forEach(callback => callback([{ isIntersecting: true }])) })
  }

  it('says there is no picture only once the row’s reads found none, still hidden from a screen reader', async () => {
    const comeNear = nearRows()
    const { container } = render(<MomentRowPicture moment={moment} />)
    const slot = container.querySelector('.moments-card-slot')!
    expect(slot.querySelector('.moments-card-label')?.textContent).toBe('')
    comeNear()
    await waitFor(() => expect(slot.querySelector('.moments-card-label [aria-hidden="true"]')?.textContent).toBe('No picture yet'))
    expect(slot.getAttribute('aria-hidden')).toBe('true')
  })

  it('reads a picture’s label as its full words only', () => {
    const artwork = { vodId: '123456789', kind: 'archive_thumbnail' as const, url: 'https://static-cdn.jtvnw.net/cf_vods/fake/thumb/thumb0-640x360.jpg' }
    const { container } = render(<MomentRowPicture moment={moment} artwork={artwork} />)
    const slot = container.querySelector('.moments-card-slot')!
    expect(slot.getAttribute('data-preview')).toBe('broadcast')
    expect(slot.getAttribute('aria-hidden')).toBeNull()
    const label = slot.querySelector('.moments-card-label')!
    expect(label.querySelector(':scope > [aria-hidden="true"]')?.textContent).toBe('VOD thumbnail')
    expect(label.querySelector(':scope > .sr-only')?.textContent).toBe('The stream’s thumbnail, not this moment')
  })
})

describe('a list row’s emotes', () => {
  // Row emotes are drawn at 24 px, above the site's 20 px still rule (STATIC_EMOTE_MAX_PX), so they pass
  // through the shared rule with their drawn size and keep their moving files. 7TV is never guessed.
  it('asks for each emote through the shared size rule at its drawn 24 px', () => {
    const twitch = 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_0123456789abcdef0123456789abcdef/default/dark/1.0'
    const seventv = 'https://cdn.7tv.app/emote/01F6MZGCNG000255K4X1K96NCT/4x.webp'
    const { container } = render(<MomentEmotes moment={{ ...moment, topEmotes: [
      { name: 'fakePog', provider: 'twitch', imageUrl: twitch, count: 12 },
      { name: 'fakeKek', provider: 'seventv', imageUrl: seventv, count: 9 },
    ] }} />)
    const [first, second] = [...container.querySelectorAll('img')]
    expect([first.getAttribute('width'), first.getAttribute('sizes')]).toEqual(['24', '24px'])
    expect(first.getAttribute('src')).toBe(emoteDisplaySrc(twitch, 24))
    expect(first.getAttribute('srcset')).toBe(emoteSrcSet(twitch, 24))
    expect(first.getAttribute('srcset')).toContain('/default/dark/2.0 2x')
    expect(second.getAttribute('srcset')).toBe(emoteSrcSet(seventv, 24))
    expect(second.getAttribute('srcset')).not.toContain('static')
    expect(first.getAttribute('fetchpriority')).toBe('low')
  })
})
