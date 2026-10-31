import { describe, expect, it, vi } from 'vitest'
import {
  boxArtSignaturesMatch,
  createTwitchPlaceholderCheck,
  isTwitchPlaceholderBoxArt,
  twitchBoxArtByName,
  twitchPlaceholderBoxArtUrl,
} from './twitchBoxArt.ts'

/** A loaded <img> as GameArt hands it over (jsdom never decodes pictures). */
function loadedImage(width: number, height: number): HTMLImageElement {
  const img = document.createElement('img')
  Object.defineProperty(img, 'complete', { configurable: true, value: true })
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: width })
  Object.defineProperty(img, 'naturalHeight', { configurable: true, value: height })
  return img
}

const GREY = Uint8ClampedArray.from({ length: 12 * 16 * 3 }, () => 100)
const COVER = Uint8ClampedArray.from({ length: 12 * 16 * 3 }, (_, i) => (i * 37) % 256)

describe('twitchBoxArtByName (GP-8)', () => {
  it('builds the name-based ttv-boxart URL at the asked size', () => {
    expect(twitchBoxArtByName('Just Chatting', 144, 192))
      .toBe('https://static-cdn.jtvnw.net/ttv-boxart/Just%20Chatting-144x192.jpg')
    expect(twitchBoxArtByName('Gakuen iDOLM@STER', 52, 72))
      .toBe('https://static-cdn.jtvnw.net/ttv-boxart/Gakuen%20iDOLM%40STER-52x72.jpg')
    expect(twitchBoxArtByName('  Call of Duty: Black Ops II ', 144, 192))
      .toBe('https://static-cdn.jtvnw.net/ttv-boxart/Call%20of%20Duty%3A%20Black%20Ops%20II-144x192.jpg')
  })

  it('returns null for a blank name or a size Twitch cannot serve', () => {
    expect(twitchBoxArtByName('   ', 144, 192)).toBeNull()
    expect(twitchBoxArtByName(undefined, 144, 192)).toBeNull()
    expect(twitchBoxArtByName('Minecraft', 0, 192)).toBeNull()
    expect(twitchBoxArtByName('Minecraft', 144.5, 192)).toBeNull()
  })

  it("names Twitch's own 404 picture at the same size", () => {
    expect(twitchPlaceholderBoxArtUrl(144, 192)).toBe('https://static-cdn.jtvnw.net/ttv-static/404_boxart-144x192.jpg')
  })
})

describe('boxArtSignaturesMatch', () => {
  it('matches the same pixels and tolerates small decoder noise', () => {
    expect(boxArtSignaturesMatch(GREY, GREY)).toBe(true)
    expect(boxArtSignaturesMatch(GREY, GREY.map(v => v + 2))).toBe(true)
  })

  it('does not match real art, or signatures of different sizes', () => {
    expect(boxArtSignaturesMatch(GREY, COVER)).toBe(false)
    expect(boxArtSignaturesMatch(GREY, GREY.slice(3))).toBe(false)
    expect(boxArtSignaturesMatch(new Uint8ClampedArray(), new Uint8ClampedArray())).toBe(false)
  })
})

describe('isTwitchPlaceholderBoxArt decision (stubbed canvas)', () => {
  function check(overrides: Partial<Parameters<typeof createTwitchPlaceholderCheck>[0]> = {}) {
    const reference = loadedImage(144, 192)
    const loadReference = vi.fn(async (_url: string) => reference as HTMLImageElement | null)
    const signatureOf = vi.fn((img: HTMLImageElement) => (img === reference ? GREY : COVER) as Uint8ClampedArray | null)
    const deps = { loadReference, signatureOf, ...overrides }
    return { isPlaceholder: createTwitchPlaceholderCheck(deps), deps, reference }
  }

  it("is true when the picture is Twitch's 404 box art of the same size", async () => {
    const { isPlaceholder, deps } = check({ signatureOf: vi.fn(() => GREY) })
    await expect(isPlaceholder(loadedImage(144, 192))).resolves.toBe(true)
    expect(deps.loadReference).toHaveBeenCalledWith('https://static-cdn.jtvnw.net/ttv-static/404_boxart-144x192.jpg')
  })

  it('is false for real art', async () => {
    const { isPlaceholder } = check()
    await expect(isPlaceholder(loadedImage(144, 192))).resolves.toBe(false)
  })

  it('loads the reference once per size', async () => {
    const { isPlaceholder, deps } = check()
    await isPlaceholder(loadedImage(144, 192))
    await isPlaceholder(loadedImage(144, 192))
    await isPlaceholder(loadedImage(52, 72))
    expect(deps.loadReference).toHaveBeenCalledTimes(2)
    expect(deps.loadReference).toHaveBeenLastCalledWith('https://static-cdn.jtvnw.net/ttv-static/404_boxart-52x72.jpg')
  })

  it('keeps the picture (false) when the reference fails to load, and tries the reference again next time', async () => {
    const loadReference = vi.fn(async () => null)
    const { isPlaceholder } = check({ loadReference, signatureOf: vi.fn(() => GREY) })
    await expect(isPlaceholder(loadedImage(144, 192))).resolves.toBe(false)
    await expect(isPlaceholder(loadedImage(144, 192))).resolves.toBe(false)
    expect(loadReference).toHaveBeenCalledTimes(2)
  })

  it('keeps the picture (false) on any canvas error', async () => {
    const { isPlaceholder } = check({ signatureOf: vi.fn(() => { throw new Error('SecurityError: tainted canvas') }) })
    await expect(isPlaceholder(loadedImage(144, 192))).resolves.toBe(false)
    const { isPlaceholder: noCanvas } = check({ signatureOf: vi.fn(() => null) })
    await expect(noCanvas(loadedImage(144, 192))).resolves.toBe(false)
  })

  it('keeps a picture that has not loaded (false) without asking for a reference', async () => {
    const { isPlaceholder, deps } = check({ signatureOf: vi.fn(() => GREY) })
    await expect(isPlaceholder(loadedImage(0, 0))).resolves.toBe(false)
    expect(deps.loadReference).not.toHaveBeenCalled()
  })

  it('the default check keeps the picture in jsdom, which has no canvas', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(isTwitchPlaceholderBoxArt(loadedImage(144, 192))).resolves.toBe(false)
    error.mockRestore()
  })
})
