import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConsoleEmoteImg } from './ConsoleEmoteImg.tsx'

describe('ConsoleEmoteImg', () => {
  it('resets the load attempt when the source changes', () => {
    const firstSrc = '/emotes/11111111-1111-4111-8111-111111111111/1x.webp'
    const secondSrc = '/emotes/22222222-2222-4222-8222-222222222222/1x.webp'
    const view = render(<ConsoleEmoteImg src={firstSrc} name="First" />)
    const first = view.container.querySelector('img')
    expect(first?.getAttribute('src')).toBe(firstSrc)

    fireEvent.error(first!)
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe(`${firstSrc}?sp_retry=1`)

    view.rerender(<ConsoleEmoteImg src={secondSrc} name="Second" />)
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe(secondSrc)
  })

  it('tries one fallback and then renders the accessible placeholder', () => {
    const view = render(
      <ConsoleEmoteImg
        src="https://cdn.7tv.app/emote/0123456789abcdefghjk/2x.webp"
        fallbackSrc="https://cdn.7tv.app/emote/abcdefghjk0123456789/2x.webp"
        name="Kappa"
        fallbackClassName="fallback"
      />,
    )
    fireEvent.error(view.container.querySelector('img')!)
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.7tv.app/emote/abcdefghjk0123456789/2x.webp')

    fireEvent.error(view.container.querySelector('img')!)
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.querySelector('.fallback')?.textContent).toBe('K')
  })

  it('uses a smaller 7TV asset on retry', () => {
    const view = render(
      <ConsoleEmoteImg
        src="https://cdn.7tv.app/emote/62a3bf572b964d6cc2766004/4x.webp"
        name="7TV"
      />,
    )
    fireEvent.error(view.container.querySelector('img')!)
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.7tv.app/emote/62a3bf572b964d6cc2766004/2x.webp?sp_retry=1',
    )
  })

  it('promotes a safe provider fallback when the primary proxy path is rejected', () => {
    const view = render(
      <ConsoleEmoteImg
        src="/v1/portal/analytics/emotes/proxy/bt1.png"
        fallbackSrc="https://cdn.frankerfacez.com/emote/bt1/1"
        name="Clap"
      />,
    )
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.frankerfacez.com/emote/bt1/1',
    )
  })

  it('rejects executable and arbitrary-host image sources', () => {
    const view = render(<ConsoleEmoteImg src="javascript:alert(1)" name="Unsafe" />)
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.textContent).toBe('U')

    view.rerender(<ConsoleEmoteImg src="https://example.com/emote.webp" name="Foreign" />)
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.textContent).toBe('F')
  })
})
