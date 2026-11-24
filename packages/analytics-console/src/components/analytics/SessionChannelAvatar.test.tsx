import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionChannelAvatar } from './SessionChannelAvatar.tsx'

const PICTURE = 'https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-300x300.png'
const SMALL = 'https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-150x150.png'

const avatar = (container: HTMLElement) => container.querySelector('[data-channel-avatar]')!
const picture = (container: HTMLElement) => avatar(container).querySelector('img')

afterEach(() => cleanup())

describe('SessionChannelAvatar', () => {
  it('asks for the 150 px Twitch rendition, with the 300 px one for dense screens', () => {
    const { container } = render(<SessionChannelAvatar name="xQc" src={PICTURE} live={false} />)
    const img = picture(container)!
    expect(img.getAttribute('src')).toBe(SMALL)
    expect(img.getAttribute('srcset')).toBe(`${SMALL} 150w, ${PICTURE} 300w`)
    expect(img.getAttribute('sizes')).toBe('(min-width: 1024px) 62px, (min-width: 640px) 52px, 44px')
    expect(img.getAttribute('width')).toBe('62')
    expect(img.getAttribute('height')).toBe('62')
  })

  it('reads the older picture name with a hash before the size', () => {
    const hashed = 'https://static-cdn.jtvnw.net/jtv_user_pictures/xqc-profile_image-9298dca608632101-300x300.jpeg'
    const smallHashed = 'https://static-cdn.jtvnw.net/jtv_user_pictures/xqc-profile_image-9298dca608632101-150x150.jpeg'
    const { container } = render(<SessionChannelAvatar name="xQc" src={hashed} live={false} />)
    const img = picture(container)!
    expect(img.getAttribute('src')).toBe(smallHashed)
    expect(img.getAttribute('srcset')).toBe(`${smallHashed} 150w, ${hashed} 300w`)
  })

  it('tries the original picture once when the rendition fails, then shows the first letter', () => {
    const { container } = render(<SessionChannelAvatar name="xQc" src={PICTURE} live />)
    fireEvent.error(picture(container)!)
    const original = picture(container)!
    expect(original.getAttribute('src')).toBe(PICTURE)
    expect(original.hasAttribute('srcset')).toBe(false)
    expect(original.hasAttribute('sizes')).toBe(false)

    fireEvent.error(original)
    expect(picture(container)).toBeNull()
    expect(avatar(container).textContent).toBe('X')
    expect(avatar(container).hasAttribute('data-live')).toBe(true)
  })

  it('passes other pictures through unchanged and shows the letter after one failure', () => {
    const other = 'https://example.com/avatar.png'
    const { container } = render(<SessionChannelAvatar name="shroud" src={other} live={false} />)
    const img = picture(container)!
    expect(img.getAttribute('src')).toBe(other)
    expect(img.hasAttribute('srcset')).toBe(false)
    fireEvent.error(img)
    expect(picture(container)).toBeNull()
    expect(avatar(container).textContent).toBe('S')
  })

  it('keeps a Twitch picture already at 150 px or less as it is', () => {
    const small = 'https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-70x70.png'
    const { container } = render(<SessionChannelAvatar name="xQc" src={small} live={false} />)
    const img = picture(container)!
    expect(img.getAttribute('src')).toBe(small)
    expect(img.hasAttribute('srcset')).toBe(false)
  })

  it('shows the first letter when there is no picture', () => {
    const { container } = render(<SessionChannelAvatar name="  xQc" src={null} live={false} />)
    expect(picture(container)).toBeNull()
    expect(avatar(container).textContent).toBe('X')
  })
})
