/**
 * GameArt box art by name (LW-5/GP-5, fix, 10-30). The hub sends no art per
 * live channel, so a game without vetted moment art showed only its initials.
 * Twitch serves box art by name, but an unknown name gets its grey "?" cover
 * with HTTP 200: the cover loads with CORS, stays hidden until the placeholder
 * check clears it, and a proven placeholder or a failed load shows the initials.
 */
import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const check = vi.hoisted(() => ({ placeholder: vi.fn(async (_img: HTMLImageElement) => false) }))

vi.mock('../../packages/analytics-console/src/utils/twitchBoxArt.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../packages/analytics-console/src/utils/twitchBoxArt.ts')>()),
  isTwitchPlaceholderBoxArt: check.placeholder,
}))

import { GameArt } from '../src/ui/components/hub/v5/HubV5Rack'
import { HUB_NO_CATEGORY } from '../src/ui/components/hub/v5/hubV5Model'

const GTA_BY_NAME = 'https://static-cdn.jtvnw.net/ttv-boxart/Grand%20Theft%20Auto%20V-60x80.jpg'

afterEach(() => {
  check.placeholder.mockReset()
  check.placeholder.mockImplementation(async () => false)
})

describe('GameArt box art by name (fix, 10-30)', () => {
  it('loads Twitch box art by name with CORS when no vetted art is known', () => {
    const { container } = render(<GameArt url={undefined} name="Grand Theft Auto V" w={30} h={40} />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe(GTA_BY_NAME)
    expect(img!.getAttribute('crossorigin')).toBe('anonymous')
    expect(img!.getAttribute('referrerpolicy')).toBe('no-referrer')
    // hidden until the placeholder check clears it
    expect(img!.style.opacity).toBe('0')
  })

  it('shows the cover once the check says it is not the "?" placeholder', async () => {
    const { container } = render(<GameArt url={undefined} name="Grand Theft Auto V" w={30} h={40} />)
    const img = container.querySelector('img')!
    await act(async () => { fireEvent.load(img) })
    expect(check.placeholder).toHaveBeenCalledWith(img)
    expect(container.querySelector('img')!.style.opacity).toBe('')
    expect(container.textContent).toBe('')
  })

  it('falls back to the initials when the cover is Twitch\'s placeholder', async () => {
    check.placeholder.mockImplementation(async () => true)
    const { container } = render(<GameArt url={undefined} name="Grand Theft Auto V" w={30} h={40} />)
    await act(async () => { fireEvent.load(container.querySelector('img')!) })
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toBe('GT')
  })

  it('falls back to the initials when the cover does not load', () => {
    const { container } = render(<GameArt url={undefined} name="Grand Theft Auto V" w={30} h={40} />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toBe('GT')
  })

  it('keeps the cover when the check cannot tell', async () => {
    check.placeholder.mockImplementation(async () => { throw new Error('tainted canvas') })
    const { container } = render(<GameArt url={undefined} name="Grand Theft Auto V" w={30} h={40} />)
    await act(async () => { fireEvent.load(container.querySelector('img')!) })
    expect(container.querySelector('img')!.style.opacity).toBe('')
  })

  it('asks for nothing by name for "No category"', () => {
    const { container } = render(<GameArt url={undefined} name={HUB_NO_CATEGORY} w={30} h={40} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toBe('NC')
  })

  it('tries the next game after a failed one', () => {
    const { container, rerender } = render(<GameArt url={undefined} name="Grand Theft Auto V" w={30} h={40} />)
    fireEvent.error(container.querySelector('img')!)
    rerender(<GameArt url={undefined} name="Just Chatting" w={30} h={40} />)
    expect(container.querySelector('img')!.getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/Just%20Chatting-60x80.jpg')
  })

  it('keeps vetted art as before: three times the box, no CORS, no check', async () => {
    const { container } = render(<GameArt url="https://static-cdn.jtvnw.net/ttv-boxart/32982_IGDB-52x72.jpg" name="Grand Theft Auto V" w={30} h={40} />)
    const img = container.querySelector('img')!
    expect(img.getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/32982_IGDB-90x120.jpg')
    expect(img.hasAttribute('crossorigin')).toBe(false)
    expect(img.style.opacity).toBe('')
    await act(async () => { fireEvent.load(img) })
    expect(check.placeholder).not.toHaveBeenCalled()
    fireEvent.error(img)
    expect(container.textContent).toBe('GT')
  })
})
