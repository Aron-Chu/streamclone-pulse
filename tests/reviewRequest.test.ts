import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordNewDeviceBookmark, REVIEW_REQUEST_KEY } from '../src/background/reviewRequest.ts'
import { reviewDestination } from '../src/shared/reviewDestination.ts'

function local(initial?: unknown) {
  let value = initial
  return {
    get: vi.fn(async () => value === undefined ? {} : { [REVIEW_REQUEST_KEY]: value }),
    set: vi.fn(async (values: Record<string, unknown>) => { value = values[REVIEW_REQUEST_KEY] }),
    value: () => value,
  }
}
afterEach(() => vi.unstubAllGlobals())

describe('one-time local review request', () => {
  it('offers once after three serialized successful increments, including concurrent calls', async () => {
    const storage = local()
    expect(await Promise.all(Array.from({ length: 5 }, () => recordNewDeviceBookmark(storage)))).toEqual([false, false, true, false, false])
    expect(storage.value()).toEqual({ bookmarks: 3, offered: true })
    expect(storage.set).toHaveBeenCalledTimes(3)
    // Only a count and a consumed flag: no bookmark, channel, account or event data.
    expect(Object.keys(storage.value() as object)).toEqual(['bookmarks', 'offered'])
  })

  it('does not offer again after a worker/module restart', async () => {
    const storage = local({ bookmarks: 3, offered: true })
    vi.resetModules()
    const fresh = await import('../src/background/reviewRequest.ts')
    expect(await fresh.recordNewDeviceBookmark(storage)).toBe(false)
    expect(storage.set).not.toHaveBeenCalled()
  })

  it('never offers without committed local persistence or with damaged state', async () => {
    const storage = local({ bookmarks: 2, offered: false })
    storage.set.mockRejectedValueOnce(new Error('Storage full'))
    expect(await recordNewDeviceBookmark(storage)).toBe(false)
    expect(storage.value()).toEqual({ bookmarks: 2, offered: false })
    for (const value of [null, {}, { bookmarks: -1, offered: false }, { bookmarks: 99, offered: false }, { bookmarks: 2, offered: 'false' }]) {
      expect(await recordNewDeviceBookmark(local(value))).toBe(false)
    }
    vi.stubGlobal('chrome', undefined)
    expect(await recordNewDeviceBookmark()).toBe(false)
  })
})

describe('packaged store review destinations', () => {
  it('selects only fixed public Chrome or Firefox review pages', () => {
    expect(reviewDestination('cws')).toBe('https://chromewebstore.google.com/detail/streampulse/nifgoonpcgmdhiffcpmhndjgkgahnelg/reviews')
    expect(reviewDestination('firefox')).toBe('https://addons.mozilla.org/en-US/firefox/addon/streampulse/reviews/')
    expect(reviewDestination('development')).toBe(reviewDestination('cws'))
    expect(reviewDestination('edge')).toBeNull()
  })
})
