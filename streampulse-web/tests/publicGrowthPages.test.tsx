import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TwitchTimestampTool from '../src/routes/public/TwitchTimestampTool'
import FindTwitchMomentsGuide from '../src/routes/public/FindTwitchMomentsGuide'
import TwitchVodTimestampsGuide from '../src/routes/public/TwitchVodTimestampsGuide'
import { resolvePageMetadata } from '../src/lib/pageMetadata'
import { GROWTH_PAGES } from '../src/lib/growthPages'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function tool() { render(<MemoryRouter><TwitchTimestampTool /></MemoryRouter>) }
function build() {
  fireEvent.change(screen.getByLabelText('Twitch VOD link or video ID'), { target: { value: '2916038039' } })
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '1:23:45' } })
  fireEvent.click(screen.getByRole('button', { name: 'Build timestamp link' }))
}
describe('public timestamp tool', () => {
  it('announces an error and focuses the invalid source without producing an outbound link', () => {
    tool(); fireEvent.click(screen.getByRole('button', { name: 'Build timestamp link' }))
    expect(screen.getByRole('alert').textContent).toContain('past-broadcast')
    expect(document.activeElement).toBe(screen.getByLabelText('Twitch VOD link or video ID'))
    expect(screen.queryByRole('link', { name: 'Open on Twitch' })).toBeNull()
  })
  it('copies only the clean constructed link and clears stale output after an edit', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    tool(); build()
    expect(screen.getByRole('link', { name: 'Open on Twitch' }).getAttribute('href')).toBe('https://www.twitch.tv/videos/2916038039?t=1h23m45s')
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://www.twitch.tv/videos/2916038039?t=1h23m45s'))
    expect(await screen.findByText('Link copied.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '5' } })
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull()
  })
  it.each(['resolve', 'reject'])('ignores a stale clipboard %s after rebuilding another link', async outcome => {
    let settle!: () => void
    const pending = new Promise<void>((resolve, reject) => { settle = () => outcome === 'resolve' ? resolve() : reject(new Error('denied')) })
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(() => pending) } })
    tool(); build(); fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Build timestamp link' }))
    const focusBefore = document.activeElement
    await act(async () => { settle(); await pending.catch(() => undefined) })
    expect(screen.getByRole('link', { name: 'Open on Twitch' }).getAttribute('href')).toContain('t=0h0m5s')
    expect(screen.queryByText('Link copied.')).toBeNull()
    expect(screen.queryByText(/Copy is unavailable here/)).toBeNull()
    expect(document.activeElement).toBe(focusBefore)
  })
  it('provides honest manual-copy recovery when clipboard access fails', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    tool(); build(); fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(await screen.findByText(/Copy is unavailable here/)).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Timestamped Twitch link'))
  })
})

describe('public growth page content and metadata', () => {
  it('gives the three real pages unique indexable self-canonicals', () => {
    for (const page of GROWTH_PAGES) expect(resolvePageMetadata(page.canonicalPath)).toMatchObject({ title: page.title, canonicalPath: page.canonicalPath, robots: 'index,follow' })
    expect(new Set(GROWTH_PAGES.map(page => page.title)).size).toBe(3)
    expect(resolvePageMetadata('/tools/nonexistent').robots).toBe('noindex,nofollow')
  })
  it('keeps the tracked-stream and local-bookmark limitations visible in the workflow guide', () => {
    render(<MemoryRouter><FindTwitchMomentsGuide /></MemoryRouter>)
    expect(screen.getByText(/does not reconstruct missing history/)).toBeTruthy()
    expect(screen.getByText(/not a cross-device backup/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'timestamp link builder' }).getAttribute('href')).toBe('/tools/twitch-vod-timestamp-link')
  })
  it('explains retention, alignment and restrictions with official source links', () => {
    render(<MemoryRouter><TwitchVodTimestampsGuide /></MemoryRouter>)
    expect(screen.getByText('7 days for other broadcasters.')).toBeTruthy()
    expect(screen.getByText('14 days for Affiliates.')).toBeTruthy()
    expect(screen.getByText('60 days for Partners, Prime and Turbo users.')).toBeTruthy()
    expect(screen.getByText(/does not restore deleted VODs/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Twitch’s on-demand content guide' }).getAttribute('href')).toBe('https://help.twitch.tv/s/article/video-on-demand')
  })
})
