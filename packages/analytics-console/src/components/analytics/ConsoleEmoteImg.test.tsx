import { fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { configureEmoteAssetBase } from '../../configureApi.ts'
import { ConsoleEmoteImg } from './ConsoleEmoteImg.tsx'

const PROXY = 'https://api.streampulse.stream'

describe('ConsoleEmoteImg', () => {
  afterEach(() => configureEmoteAssetBase(() => ''))

  it('resets the load attempt when the source changes', () => {
    configureEmoteAssetBase(() => PROXY)
    const view = render(<ConsoleEmoteImg src="/emotes/first.webp" name="First" />)
    const first = view.container.querySelector('img')
    expect(first?.getAttribute('src')).toBe(`${PROXY}/emotes/first.webp`)

    fireEvent.error(first!)
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe(`${PROXY}/emotes/first.webp?sp_retry=1`)

    view.rerender(<ConsoleEmoteImg src="/emotes/second.webp" name="Second" />)
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe(`${PROXY}/emotes/second.webp`)
  })

  it('tries one fallback and then renders the accessible placeholder', () => {
    const view = render(
      <ConsoleEmoteImg
        src={`${PROXY}/emotes/primary.webp`}
        fallbackSrc={`${PROXY}/emotes/fallback.webp`}
        name="Kappa"
        fallbackClassName="fallback"
      />,
    )
    fireEvent.error(view.container.querySelector('img')!)
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe(`${PROXY}/emotes/fallback.webp`)

    fireEvent.error(view.container.querySelector('img')!)
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.querySelector('.fallback')?.textContent).toBe('K')
  })

  it('never binds a non-https or unlisted host; the placeholder shows instead', () => {
    for (const src of ['javascript:alert(1)', 'http://cdn.7tv.app/emote/x/1x.webp', 'https://cdn.example/emote.webp', 'data:image/png;base64,AAAA']) {
      const view = render(<ConsoleEmoteImg src={src} name="Unsafe" fallbackClassName="fallback" />)
      expect(view.container.querySelector('img'), src).toBeNull()
      expect(view.container.querySelector('.fallback')?.textContent).toBe('U')
      view.unmount()
    }
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

  it('requests the display-sized asset first, with a 2x candidate', () => {
    const view = render(<ConsoleEmoteImg src="https://cdn.7tv.app/emote/62a3bf572b964d6cc2766004/4x.webp" name="7TV" />)
    const img = view.container.querySelector('img')!
    expect(img.getAttribute('src')).toBe('https://cdn.7tv.app/emote/62a3bf572b964d6cc2766004/1x.webp')
    expect(img.getAttribute('srcset')).toBe('https://cdn.7tv.app/emote/62a3bf572b964d6cc2766004/1x.webp 1x, https://cdn.7tv.app/emote/62a3bf572b964d6cc2766004/2x.webp 2x')
    fireEvent.error(img)
    expect(view.container.querySelector('img')?.getAttribute('srcset')).toBeNull()
  })
})
