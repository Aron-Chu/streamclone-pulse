import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import FindTwitchMomentsGuide from '../src/routes/public/FindTwitchMomentsGuide'
import TwitchVodTimestampsGuide from '../src/routes/public/TwitchVodTimestampsGuide'
import GuidesIndex, { GUIDE_CARDS } from '../src/routes/public/GuidesIndex'
import HowMomentsArePickedGuide from '../src/routes/public/HowMomentsArePickedGuide'
import ReadingTheChatChartGuide from '../src/routes/public/ReadingTheChatChartGuide'
import { resolvePageMetadata } from '../src/lib/pageMetadata'
import { GROWTH_PAGES, TIMESTAMP_TOOL_PATH } from '../src/lib/growthPages'
import { captureTimestampLinkBuilt } from '../src/lib/productAnalytics'

vi.mock('../src/lib/productAnalytics', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/productAnalytics')>(),
  captureTimestampLinkBuilt: vi.fn(),
}))
vi.mock('../src/ui/components/TimestampToolFeedback', () => ({ TimestampToolFeedback: () => <span data-testid="feedback-invitation" /> }))

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.mocked(captureTimestampLinkBuilt).mockClear() })
// The builder now opens the timestamps guide.
function tool() { render(<MemoryRouter><TwitchVodTimestampsGuide /></MemoryRouter>) }
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
    expect(captureTimestampLinkBuilt).not.toHaveBeenCalled()
  })
  it('copies only the clean constructed link and clears stale output after an edit', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    tool(); build()
    expect(screen.queryByTestId('feedback-invitation')).toBeNull()
    expect(captureTimestampLinkBuilt).toHaveBeenCalledExactlyOnceWith()
    expect(screen.getByRole('link', { name: 'Open on Twitch' }).getAttribute('href')).toBe('https://www.twitch.tv/videos/2916038039?t=1h23m45s')
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://www.twitch.tv/videos/2916038039?t=1h23m45s'))
    expect(await screen.findByText('Link copied.')).toBeTruthy()
    expect(screen.getByTestId('feedback-invitation')).toBeTruthy()
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
    expect(screen.queryByTestId('feedback-invitation')).toBeNull()
    expect(screen.queryByText(/Copy is unavailable here/)).toBeNull()
    expect(document.activeElement).toBe(focusBefore)
  })
  it('provides honest manual-copy recovery when clipboard access fails', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    tool(); build(); fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(await screen.findByText(/Copy is unavailable here/)).toBeTruthy()
    expect(screen.queryByTestId('feedback-invitation')).toBeNull()
    expect(document.activeElement).toBe(screen.getByLabelText('Timestamped Twitch link'))
  })
})

describe('public growth page content and metadata', () => {
  it('gives the real pages unique indexable self-canonicals', () => {
    for (const page of GROWTH_PAGES) expect(resolvePageMetadata(page.canonicalPath)).toMatchObject({ title: page.title, canonicalPath: page.canonicalPath, robots: 'index,follow' })
    expect(new Set(GROWTH_PAGES.map(page => page.title)).size).toBe(GROWTH_PAGES.length)
    expect(resolvePageMetadata('/tools/nonexistent').robots).toBe('noindex,nofollow')
  })
  it('points the builder\'s old address at the guide it moved into', () => {
    const guide = GROWTH_PAGES.find(page => page.canonicalPath === '/guides/twitch-vod-timestamps')!
    expect(GROWTH_PAGES.map(page => page.canonicalPath as string)).not.toContain(TIMESTAMP_TOOL_PATH)
    expect(resolvePageMetadata(TIMESTAMP_TOOL_PATH)).toMatchObject({ title: guide.title, canonicalPath: guide.canonicalPath, robots: 'noindex,nofollow' })
  })
  it('opens the timestamps guide with the builder, before the explanations', () => {
    tool()
    const builder = screen.getByRole('button', { name: 'Build timestamp link' })
    const firstSection = screen.getAllByRole('heading', { level: 2 })[0]
    expect(builder.compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(document.getElementById('builder')).toBeTruthy()
  })
  it('keeps the tracked-stream and local-bookmark limitations visible in the workflow guide', () => {
    render(<MemoryRouter><FindTwitchMomentsGuide /></MemoryRouter>)
    expect(screen.getByText(/does not reconstruct missing history/)).toBeTruthy()
    expect(screen.getByText(/not a cross-device backup/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'timestamp link builder' }).getAttribute('href')).toBe('/guides/twitch-vod-timestamps')
  })
  it('explains retention, alignment and restrictions with official source links', () => {
    render(<MemoryRouter><TwitchVodTimestampsGuide /></MemoryRouter>)
    expect(screen.getByText('7 days for most broadcasters.')).toBeTruthy()
    expect(screen.getByText('14 days for Affiliates.')).toBeTruthy()
    expect(screen.getByText('60 days for Partners, Prime and Turbo users.')).toBeTruthy()
    expect(screen.getByText(/doesn’t restore deleted replays/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Twitch’s on-demand content guide' }).getAttribute('href')).toBe('https://help.twitch.tv/s/article/video-on-demand')
  })
})

describe('guides index and the two short guides', () => {
  const guidePaths = GROWTH_PAGES.map(page => page.canonicalPath as string).filter(path => path.startsWith('/guides/'))
  const related = () => screen.getByRole('navigation', { name: /^Related/ })
  const relatedHrefs = () => [...related().querySelectorAll('a')].map(link => link.getAttribute('href'))

  it('gives every guide a card, plus the timestamp builder, and each card title is its link', () => {
    render(<MemoryRouter><GuidesIndex /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Guides' })).toBeTruthy()
    const cards = within(document.querySelector<HTMLElement>('.guides-index')!).getAllByRole('listitem')
    expect(cards).toHaveLength(GUIDE_CARDS.length)
    const hrefs = cards.map(card => card.querySelector('h2 a')?.getAttribute('href'))
    for (const path of guidePaths) expect(hrefs, path).toContain(path)
    expect(hrefs).toContain('/guides/twitch-vod-timestamps#builder')
    for (const card of GUIDE_CARDS) expect(screen.getByRole('link', { name: card.title }).getAttribute('href')).toBe(card.to)
  })

  it('lists the index and both new guides in the sitemap', () => {
    const sitemap = readFileSync(resolve(process.cwd(), 'public/sitemap.xml'), 'utf8')
    const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => new URL(match[1]).pathname)
    for (const path of ['/guides', '/guides/how-moments-are-picked', '/guides/reading-the-chat-chart']) expect(urls, path).toContain(path)
  })

  it('keeps the Moments guide to what the picker does, and says what a Moment cannot tell you', () => {
    render(<MemoryRouter><HowMomentsArePickedGuide /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'How Moments are picked' })).toBeTruthy()
    expect(screen.getByText(/A jump in viewers without a rise in chat or emotes isn’t picked/)).toBeTruthy()
    expect(screen.getByText(/never filled in or guessed/)).toBeTruthy()
    expect(screen.getByText(/Emotes don’t tell you how chat felt/)).toBeTruthy()
    expect(screen.getByText(/It counts messages, not people/)).toBeTruthy()
    // The weights are configurable on the backend, so the guide says so once and gives none.
    expect(screen.getAllByText(/can be tuned/)).toHaveLength(1)
    expect(relatedHrefs()).toEqual(expect.arrayContaining(['/guides/reading-the-chat-chart', '/guides']))
  })

  it('tells quiet, not recorded and unknown apart on the chart', () => {
    render(<MemoryRouter><ReadingTheChatChartGuide /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Reading the chat chart' })).toBeTruthy()
    expect(screen.getByText(/read the minute and nothing happened/)).toBeTruthy()
    expect(screen.getByText(/hatched stripes, never as a zero/)).toBeTruthy()
    expect(screen.getByText(/reads “—”, never a number/)).toBeTruthy()
    expect(screen.getByText(/isn’t a score/)).toBeTruthy()
    expect(relatedHrefs()).toEqual(expect.arrayContaining(['/guides/how-moments-are-picked', '/guides']))
  })

  it('links the index and both new guides from the older guides', () => {
    for (const Guide of [FindTwitchMomentsGuide, TwitchVodTimestampsGuide]) {
      render(<MemoryRouter><Guide /></MemoryRouter>)
      expect(relatedHrefs()).toEqual(expect.arrayContaining(['/guides', '/guides/how-moments-are-picked', '/guides/reading-the-chat-chart']))
      cleanup()
    }
  })
})
