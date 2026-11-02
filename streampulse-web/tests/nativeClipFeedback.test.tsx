import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NativeClipWatchPage from '../src/routes/analytics/NativeClipWatchPage'
import { commentProblem, toClipComment, toClipFeedback } from '../src/lib/clipFeedback'
import { resetClipListsForTests } from '../src/lib/nativeClipsList'
import { resetAccountSessionForTests } from '../src/lib/accountSession'
import { nativeClipsPage, rawNativeClip } from './fixtures/nativeClips'

vi.mock('../src/ui/components/analytics/AnalyticsFigmaShell', () => ({ AnalyticsFigmaShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

const CLIP = 'BraveClipSlug-abc_1'
const CSRF = 'a'.repeat(64)
let cookie = ''
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const feedback = (over: { worth?: number; total?: number | null; share?: number | null; signedIn?: boolean; canWrite?: boolean; verdict?: string | null; comments?: number } = {}) => ({
  schemaVersion: 1, clipId: CLIP,
  reviews: { worth: over.worth ?? 3, total: over.total ?? null, share: over.share ?? null },
  you: { signedIn: over.signedIn ?? false, canWrite: over.canWrite ?? false, verdict: over.verdict ?? null },
  comments: { total: over.comments ?? 2 },
})
const comment = (n: number, over: Record<string, unknown> = {}) => ({
  id: uuid(n), body: `comment ${n}`, createdAt: '2026-11-01T10:00:00Z',
  author: { login: `viewer${n}`, displayName: `Viewer${n}`, profileImageUrl: 'https://evil.example/x.png' },
  mine: false, reportedByYou: false, ...over,
})

type Handler = (url: URL, init: RequestInit | undefined) => { status?: number; body?: unknown; headers?: Record<string, string> }
let calls: Array<{ method: string; path: string; init?: RequestInit }>
function serve(routes: Record<string, Handler>) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const method = init?.method ?? 'GET'
    calls.push({ method, path: url.pathname + url.search, init })
    if (url.pathname === '/v1/public/clips') return Response.json(nativeClipsPage([rawNativeClip()]))
    const handler = routes[`${method} ${url.pathname}`]
    if (!handler) return Response.json({ error: 'not found' }, { status: 404 })
    const answer = handler(url, init)
    if (answer.status === 204) return new Response(null, { status: 204 })
    return Response.json(answer.body ?? {}, { status: answer.status ?? 200, headers: answer.headers })
  }))
}

const renderPage = () => render(
  <MemoryRouter initialEntries={[`/analytics/clips/${CLIP}`]}>
    <Routes>
      <Route path="/analytics/clips/:clipId" element={<NativeClipWatchPage />} />
      <Route path="/account/sign-in" element={<p>Sign-in page</p>} />
    </Routes>
  </MemoryRouter>,
)

beforeEach(() => {
  resetClipListsForTests()
  window.localStorage.clear()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Element.prototype.scrollIntoView = () => {}
  // jsdom refuses __Host- cookies over http, so the cookie is read through a stub.
  cookie = `__Host-pulse_csrf=${CSRF}`
  vi.spyOn(document, 'cookie', 'get').mockImplementation(() => cookie)
  resetAccountSessionForTests()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Clip reviews and comments: reading answers', () => {
  it('shows the share only from 10 reviews, and never trusts a share without them', () => {
    expect(toClipFeedback(feedback({ worth: 3, total: 4, share: 0.75 }), CLIP)?.reviews).toEqual({ worth: 3, total: null, share: null })
    expect(toClipFeedback(feedback({ worth: 9, total: 10, share: 0.9 }), CLIP)?.reviews).toEqual({ worth: 9, total: 10, share: 0.9 })
    expect(toClipFeedback(feedback(), 'OtherClip')).toBeNull()
    expect(toClipFeedback({ ...feedback(), schemaVersion: 2 }, CLIP)).toBeNull()
    // canWrite and a verdict mean nothing without a session.
    expect(toClipFeedback(feedback({ signedIn: false, canWrite: true, verdict: 'worth' }), CLIP)?.you).toEqual({ signedIn: false, canWrite: false, verdict: null })
  })

  it('drops malformed comments and pictures from other hosts', () => {
    expect(toClipComment(comment(1))?.author.profileImageUrl).toBe('')
    expect(toClipComment(comment(1, { author: { login: 'a', displayName: 'A', profileImageUrl: 'https://static-cdn.jtvnw.net/u/a.png' } }))?.author.profileImageUrl).toBe('https://static-cdn.jtvnw.net/u/a.png')
    expect(toClipComment(comment(1, { id: 'not-a-uuid' }))).toBeNull()
    expect(toClipComment(comment(1, { body: 'x'.repeat(281) }))).toBeNull()
    expect(toClipComment(comment(1, { author: { login: 'Bad Login', displayName: 'x' } }))).toBeNull()
    // A display name that isn't a plain login comes with an empty login, and still shows.
    expect(toClipComment(comment(1, { author: { login: '', displayName: '빛나는별', profileImageUrl: '' } }))?.author.displayName).toBe('빛나는별')
    expect(toClipComment(comment(1, { author: { login: '', displayName: ' ', profileImageUrl: '' } }))).toBeNull()
  })

  it('checks a comment the way the backend does', () => {
    expect(commentProblem('   ')).toBe('Write something first.')
    expect(commentProblem('x'.repeat(280))).toBeNull()
    expect(commentProblem('x'.repeat(281))).toMatch(/280 characters/)
    expect(commentProblem('a\nb\nc')).toBeNull()
    expect(commentProblem('a\nb\nc\nd')).toMatch(/3 lines/)
    expect(commentProblem('a\tb')).toMatch(/plain text/)
    // An emoji is one character, as the backend counts runes.
    expect(commentProblem('😀'.repeat(280))).toBeNull()
  })
})

describe('Clip reviews and comments on the page', () => {
  it('reads signed out, never shows a Skip count, and asks to sign in before a review or comment', async () => {
    serve({
      [`GET /v1/account/clips/${CLIP}/feedback`]: () => ({ body: feedback({ worth: 33, total: 40, share: 0.825 }) }),
      [`GET /v1/account/clips/${CLIP}/comments`]: () => ({ body: { schemaVersion: 1, items: [comment(1), comment(2)], total: 2, nextCursor: null } }),
    })
    renderPage()
    const worth = await screen.findByRole('button', { name: /Worth watching 33/ })
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy()
    expect(screen.getByText('83% worth watching (40 reviews)')).toBeTruthy()
    expect(await screen.findByText('comment 1')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '2 comments' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Add a comment' })).toBeNull()
    fireEvent.click(worth)
    expect(screen.getByText(/read-only until you sign in with Twitch/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sign in with Twitch' }).getAttribute('href')).toBe('/account/sign-in')
    expect(calls.some(call => call.method !== 'GET')).toBe(false)
  })

  it('sends the sign-in back to this clip in a build with the Clips page', async () => {
    vi.stubEnv('VITE_PUBLIC_NATIVE_CLIPS', 'on')
    serve({
      [`GET /v1/account/clips/${CLIP}/feedback`]: () => ({ body: feedback() }),
      [`GET /v1/account/clips/${CLIP}/comments`]: () => ({ body: { schemaVersion: 1, items: [], total: 0, nextCursor: null } }),
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Add a comment' }))
    const href = screen.getByRole('link', { name: 'Sign in with Twitch' }).getAttribute('href')
    vi.unstubAllEnvs()
    expect(href).toBe(`/account/sign-in?returnTo=${encodeURIComponent(`/analytics/clips/${CLIP}`)}`)
  })

  it('reads reviews and comments again when this tab’s account signs out', async () => {
    let signedIn = true
    serve({
      'GET /v1/account/me': () => signedIn ? ({ body: { accountId: 'account-a' } }) : ({ status: 401, body: { error: 'sign_in_required' } }),
      [`GET /v1/account/clips/${CLIP}/feedback`]: () => ({ body: feedback({ signedIn, canWrite: signedIn, verdict: signedIn ? 'worth' : null }) }),
      [`GET /v1/account/clips/${CLIP}/comments`]: () => ({ body: { schemaVersion: 1, items: [comment(1, { mine: signedIn })], total: 1, nextCursor: null } }),
    })
    renderPage()
    expect(await screen.findByRole('textbox', { name: 'Add a comment' })).toBeTruthy()
    await waitFor(() => expect(calls.filter(call => call.path === '/v1/account/me')).toHaveLength(1))
    expect((await screen.findByRole('button', { name: /Worth watching/ })).getAttribute('aria-pressed')).toBe('true')
    // Signed out in another tab: the cookies are gone, noticed when this tab is used again.
    signedIn = false
    cookie = ''
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(await screen.findByRole('button', { name: 'Add a comment' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Add a comment' })).toBeNull()
    expect(screen.getByRole('button', { name: /Worth watching/ }).getAttribute('aria-pressed')).toBe('false')
    expect(calls.filter(call => call.path === `/v1/account/clips/${CLIP}/feedback`)).toHaveLength(2)
  })

  it('sends a review with the CSRF header, and takes it back on a second press', async () => {
    let verdict: string | null = null
    serve({
      [`GET /v1/account/clips/${CLIP}/feedback`]: () => ({ body: feedback({ signedIn: true, canWrite: true }) }),
      [`GET /v1/account/clips/${CLIP}/comments`]: () => ({ body: { schemaVersion: 1, items: [], total: 0, nextCursor: null } }),
      [`PUT /v1/account/clips/${CLIP}/review`]: (_url, init) => { verdict = JSON.parse(String(init?.body)).verdict; return { body: feedback({ signedIn: true, canWrite: true, worth: 4, verdict }) } },
      [`DELETE /v1/account/clips/${CLIP}/review`]: () => { verdict = null; return { body: feedback({ signedIn: true, canWrite: true, worth: 3 }) } },
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Worth watching 3/ }))
    await screen.findByRole('button', { name: /Worth watching 4/, pressed: true })
    const put = calls.find(call => call.method === 'PUT')!
    expect((put.init?.headers as Record<string, string>)['X-Pulse-CSRF']).toBe(CSRF)
    expect(put.init?.credentials).toBe('same-origin')
    expect(screen.getByText('You said worth watching.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Worth watching 4/ }))
    await screen.findByRole('button', { name: /Worth watching 3/, pressed: false })
    expect(verdict).toBeNull()
  })

  it('posts a comment at the top, deletes your own, and reports someone else’s', async () => {
    const posted = comment(9, { body: 'my take', mine: true })
    serve({
      [`GET /v1/account/clips/${CLIP}/feedback`]: () => ({ body: feedback({ signedIn: true, canWrite: true, comments: 1 }) }),
      [`GET /v1/account/clips/${CLIP}/comments`]: () => ({ body: { schemaVersion: 1, items: [comment(1)], total: 1, nextCursor: null } }),
      [`POST /v1/account/clips/${CLIP}/comments`]: (_url, init) => ({ status: 201, body: { ...posted, body: JSON.parse(String(init?.body)).body } }),
      [`DELETE /v1/account/clip-comments/${uuid(9)}`]: () => ({ status: 204 }),
      [`POST /v1/account/clip-comments/${uuid(1)}/report`]: () => ({ status: 204 }),
    })
    renderPage()
    const box = await screen.findByRole('textbox', { name: 'Add a comment' })
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: '  my take  ' } })
    expect(screen.getByText('273 left')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    await screen.findByText('my take')
    expect(JSON.parse(String(calls.find(call => call.method === 'POST')!.init?.body))).toEqual({ body: 'my take' })
    expect(screen.getByRole('heading', { name: '2 comments' })).toBeTruthy()
    const list = () => within(document.querySelector('.nc-comment-list') as HTMLElement).getAllByRole('listitem')
    const items = list()
    expect(within(items[0]).getByText('my take')).toBeTruthy()

    fireEvent.click(within(items[0]).getByRole('button', { name: /More for/ }))
    expect(within(items[0]).queryByRole('button', { name: 'Report' })).toBeNull()
    fireEvent.click(within(items[0]).getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(items[0]).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByText('my take')).toBeNull())
    expect(screen.getByRole('heading', { name: '1 comment' })).toBeTruthy()

    const other = list()[0]
    fireEvent.click(within(other).getByRole('button', { name: /More for Viewer1/ }))
    expect(within(other).queryByRole('button', { name: 'Delete' })).toBeNull()
    fireEvent.click(within(other).getByRole('button', { name: 'Report' }))
    fireEvent.click(within(other).getByRole('button', { name: 'Spam' }))
    await screen.findByText('Thanks. The comment is reported.')
    expect(JSON.parse(String(calls.find(call => call.path.endsWith('/report'))!.init?.body))).toEqual({ reason: 'spam' })
    fireEvent.click(within(other).getByRole('button', { name: /More for Viewer1/ }))
    expect(within(other).getByText('You reported this.')).toBeTruthy()
  })

  it('keeps a refused comment in the box and says why', async () => {
    serve({
      [`GET /v1/account/clips/${CLIP}/feedback`]: () => ({ body: feedback({ signedIn: true, canWrite: true, comments: 0 }) }),
      [`GET /v1/account/clips/${CLIP}/comments`]: () => ({ body: { schemaVersion: 1, items: [], total: 0, nextCursor: null } }),
      [`POST /v1/account/clips/${CLIP}/comments`]: () => ({ status: 429, body: { error: 'rate_limited', retryAfterSeconds: 90 }, headers: { 'Retry-After': '90' } }),
    })
    renderPage()
    const box = await screen.findByRole('textbox', { name: 'Add a comment' })
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    await screen.findByText(/Try again in 2 minutes/)
    expect((box as HTMLTextAreaElement).value).toBe('hello')
  })

  it('shows nothing of reviews while they are switched off, and offers Try again on an outage', async () => {
    serve({})
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Chat loses it' })
    await act(async () => {})
    expect(screen.queryByRole('button', { name: /Worth watching/ })).toBeNull()
    expect(screen.queryByText(/comments/)).toBeNull()
    cleanup()
    let up = false
    serve({
      [`GET /v1/account/clips/${CLIP}/feedback`]: () => up ? { body: feedback({ comments: 0 }) } : { status: 503, body: { error: 'unavailable' } },
      [`GET /v1/account/clips/${CLIP}/comments`]: () => ({ body: { schemaVersion: 1, items: [], total: 0, nextCursor: null } }),
    })
    renderPage()
    await screen.findByText(/Reviews and comments didn.t load/)
    up = true
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('No comments yet.')
  })
})
