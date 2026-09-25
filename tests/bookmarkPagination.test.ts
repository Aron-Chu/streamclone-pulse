import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPulseBookmarks } from '../src/background/api.ts'
import { parseBookmarkPage } from '../src/shared/bookmarkPage.ts'
import { parseBackgroundRequest } from '../src/shared/parseBackgroundRequest.ts'
vi.mock('../src/background/supporterAccountRuntime.ts', () => ({
  supporterAccount: { withCredential: async (operation: (token: string) => Promise<{ status: number }>) => {
    const result = await operation('a'.repeat(64))
    if (result.status === 401) throw new Error('account_authorization_required')
    return result
  } },
}))

const root = 'https://api.streampulse.stream'
const item = (n = 0) => ({ id: `bk_${n}`, login: 'xqc', streamId: 'stream1', vodId: '123', offsetSeconds: n,
  label: 'Reaction', notes: '', source: 'extension', createdAt: '2026-09-05T00:00:00.123Z', updatedAt: '2026-09-05T00:00:00.123Z' })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('bookmark page contract', () => {
  it('retains opaque continuation through the untrusted message boundary', () => {
    expect(parseBackgroundRequest({ type: 'LIST_BOOKMARKS', login: 'XQC', limit: 100, cursor: 'opaque_cursor-1' }))
      .toMatchObject({ type: 'LIST_BOOKMARKS', login: 'xqc', limit: 100, cursor: 'opaque_cursor-1' })
    expect(parseBackgroundRequest({ type: 'LIST_BOOKMARKS', cursor: '2026-09-05T00:00:00.123Z' })).not.toBeNull()
    for (const limit of [0, -1, 101, 1.5, '50', null, Infinity]) expect(parseBackgroundRequest({ type: 'LIST_BOOKMARKS', limit })).toBeNull()
    for (const cursor of ['', 'a'.repeat(1025), 'https://other.test', null, {}, 'a b', 'a\nb']) expect(parseBackgroundRequest({ type: 'LIST_BOOKMARKS', cursor })).toBeNull()
  })

  it('rejects malformed, duplicate, oversized and non-progressing pages rather than fake empty success', () => {
    for (const value of [null, {}, { items: null }, { items: [item(), item()] },
      { items: [item()], nextCursor: '' }, { items: [], nextCursor: 'next' },
      { items: [{ ...item(), offsetSeconds: -1 }] }, { items: [{ ...item(), notes: 2 }] },
      { items: [{ ...item(), createdAt: 'invalid' }] }, { items: [{ ...item(), vodId: 'https://other.test' }] },
      { items: [{ ...item(), score: 101 }] }, { items: Array.from({ length: 51 }, (_, i) => item(i)) }]) {
      expect(() => parseBookmarkPage(value)).toThrow('invalid_bookmark_page')
    }
    expect(parseBookmarkPage({ items: [] })).toEqual({ items: [] })
  })

  it('projects only public bookmark metadata, not ownership, credentials, or media links', () => {
    expect(parseBookmarkPage({ items: [{ ...item(), principalId: 'private', userId: 'private', token: 'secret', mediaUrl: 'https://other.test' }], nextCursor: 'opaque' }))
      .toEqual({ items: [item()], nextCursor: 'opaque' })
  })

  it('retrieves 137 equal-timestamp records across three bounded requests without truncation', async () => {
    const records = Array.from({ length: 137 }, (_, i) => item(i))
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input)
      expect(url.origin).toBe(root)
      expect(url.pathname).toBe('/v1/pulse/bookmarks')
      expect(url.searchParams.get('login')).toBe('xqc')
      expect(url.searchParams.get('limit')).toBe('50')
      expect(init?.cache).toBe('no-store')
      const start = Number(url.searchParams.get('cursor')?.replace('page_', '') ?? 0)
      return Response.json({ items: records.slice(start, start + 50), ...(start + 50 < records.length ? { nextCursor: `page_${start + 50}` } : {}) })
    })
    vi.stubGlobal('fetch', fetcher)
    const collected = []
    let cursor: string | undefined
    do {
      const page = await fetchPulseBookmarks({ login: 'xqc', limit: 50, cursor }, root)
      collected.push(...page.items); cursor = page.nextCursor
    } while (cursor)
    expect(collected).toEqual(records)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('does not accept an old-scope response or a repeating cursor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [item()], nextCursor: 'same' })))
    await expect(fetchPulseBookmarks({ cursor: 'same' }, root)).rejects.toThrow('invalid_bookmark_page')
    await expect(fetchPulseBookmarks({ login: 'other' }, root)).rejects.toThrow('invalid_bookmark_page')
    await expect(fetchPulseBookmarks({ streamId: 'other' }, root)).rejects.toThrow('invalid_bookmark_page')
    await expect(fetchPulseBookmarks({ vodId: '456' }, root)).rejects.toThrow('invalid_bookmark_page')
  })

  it('retains denial and cancellation instead of returning an empty library', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
    await expect(fetchPulseBookmarks({}, root)).rejects.toThrow('account_authorization_required')
    const controller = new AbortController()
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    vi.stubGlobal('fetch', vi.fn((_input: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      entered()
    })))
    const pending = fetchPulseBookmarks({ signal: controller.signal }, root)
    await started; controller.abort()
    await expect(pending).rejects.toThrow('extension_api_cancelled')
  })
})
