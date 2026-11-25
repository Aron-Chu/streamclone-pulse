import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AppRoutes, preloadOpeningPage } from '../src/routes/index'
import { resolvePageMetadata } from '../src/lib/pageMetadata'
import { prerenderPublicPage } from '../src/prerender'

const webRoot = resolve(import.meta.dirname, '..')
const read = (path: string) => readFileSync(resolve(webRoot, path), 'utf8')

afterEach(cleanup)
// Public pages load on demand; load this one first, as main.tsx does for the page a visit opens on.
beforeAll(() => preloadOpeningPage('/brainchat'))

describe("extension BrainChat card destination", () => {
  it('opens the BrainChat page, not the 404', () => {
    render(<MemoryRouter initialEntries={['/brainchat']}><AppRoutes /></MemoryRouter>)
    expect(screen.getByTestId('brainchat-page')).toBeTruthy()
    expect(screen.queryByTestId('not-found')).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'BrainChat' })).toBeTruthy()
  })

  it('says BrainChat is not out, offers nothing to sign up for, and calls its demo made up', () => {
    render(<MemoryRouter initialEntries={['/brainchat']}><AppRoutes /></MemoryRouter>)
    const page = screen.getByTestId('brainchat-page')
    expect(screen.getByTestId('brainchat-status').textContent).toMatch(/It isn.t out yet\./)
    expect(screen.getByTestId('brainchat-status').textContent).toMatch(/isn.t connected to the StreamPulse extension/)
    expect(screen.getByTestId('brainchat-made-up').textContent).toContain('Everything in this demo is made up: the stream, the chat and the counts.')
    // No form, no field, no date, no waitlist: BrainChat collects nothing yet.
    expect(page.querySelector('form, input, textarea, select')).toBeNull()
    expect(page.textContent).not.toMatch(/sign up now|waitlist|join the list|email|notify me|launch(es|ing)? (on|in)|20\d\d/i)
    // Its one action goes to the Hub that exists today.
    const actions = [...page.querySelectorAll<HTMLAnchorElement>('.public-document__actions a')]
    expect(actions.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['Browse the Hub', '/analytics']])
  })

  it('opens the demo on the busiest moment and reads another when one is picked', () => {
    render(<MemoryRouter initialEntries={['/brainchat']}><AppRoutes /></MemoryRouter>)
    const demo = screen.getByTestId('brainchat-demo')
    expect(screen.getAllByTestId('brainchat-busiest-card')).toHaveLength(3)
    const chips = within(within(demo).getByRole('group', { name: 'Moments on this stream' })).getAllByRole('button')
    expect(chips).toHaveLength(9)
    expect(screen.getByTestId('brainchat-read').textContent).toContain('Cheering a clutch play.')
    expect(chips[3]!.getAttribute('aria-pressed')).toBe('true')
    expect(within(screen.getByTestId('brainchat-said-most')).getAllByRole('listitem')).toHaveLength(3)

    // The quiet moment: BrainChat says it can't tell instead of guessing.
    fireEvent.click(chips[4]!)
    expect(screen.getByTestId('brainchat-read').textContent).toContain('Not sure what chat was doing.')
    expect(screen.getByTestId('brainchat-read').textContent).toContain('Too few messages to tell.')
  })

  it('answers a question from the moments it read and leaves out the one it was not sure about', () => {
    render(<MemoryRouter initialEntries={['/brainchat']}><AppRoutes /></MemoryRouter>)
    expect(screen.queryByTestId('brainchat-answer')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Where did chat laugh?' }))
    const answer = screen.getByTestId('brainchat-answer')
    expect(answer.textContent).toContain('2 of 9 moments')
    expect(within(answer).getAllByRole('button')).toHaveLength(2)
    expect(answer.textContent).toContain('Left out one moment BrainChat wasn’t sure about (1:31:52).')
    fireEvent.click(screen.getByRole('button', { name: 'Where did chat laugh?' }))
    expect(screen.queryByTestId('brainchat-answer')).toBeNull()
  })

  it('is a prerendered page kept out of search until BrainChat is out', () => {
    expect(resolvePageMetadata('/brainchat')).toEqual({
      title: 'BrainChat — StreamPulse',
      description: 'BrainChat reads Twitch chat around a moment and says what it was about. Coming later.',
      canonicalPath: '/brainchat',
      robots: 'noindex,nofollow',
    })
    const html = prerenderPublicPage('/brainchat')
    expect(html).toContain('data-testid="brainchat-page"')
    expect(html).not.toContain('Page not found')

    expect(read('scripts/prerender.mjs')).toMatch(/path: 'brainchat',\s+title: 'BrainChat — StreamPulse',/)
    expect(read('scripts/prerender.mjs')).toMatch(/canonicalPath: '\/brainchat',\s+robots: 'noindex,nofollow',/)
    expect(read('scripts/check-public-pages.mjs')).toContain("['brainchat.html', 'BrainChat — StreamPulse', 'noindex,nofollow', 'https://streampulse.stream/brainchat']")
    expect(read('scripts/check-public-links.mjs')).toMatch(/EXTERNALLY_PUBLISHED = \[[^\]]*'\/brainchat'/)
    expect(read('public/sitemap.xml')).not.toContain('https://streampulse.stream/brainchat')
  })
})
