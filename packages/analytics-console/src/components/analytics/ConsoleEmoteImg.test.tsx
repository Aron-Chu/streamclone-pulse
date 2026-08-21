import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConsoleEmoteImg } from './ConsoleEmoteImg.tsx'

describe('ConsoleEmoteImg', () => {
  it('resets the load attempt when the source changes', () => {
    const view = render(<ConsoleEmoteImg src="/emotes/first.webp" name="First" />)
    const first = view.container.querySelector('img')
    expect(first?.getAttribute('src')).toBe('/emotes/first.webp')

    fireEvent.error(first!)
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/emotes/first.webp?sp_retry=1')

    view.rerender(<ConsoleEmoteImg src="/emotes/second.webp" name="Second" />)
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/emotes/second.webp')
  })

  it('tries one fallback and then renders the accessible placeholder', () => {
    const view = render(
      <ConsoleEmoteImg
        src="https://cdn.example/primary.webp"
        fallbackSrc="https://cdn.example/fallback.webp"
        name="Kappa"
        fallbackClassName="fallback"
      />,
    )
    fireEvent.error(view.container.querySelector('img')!)
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/fallback.webp')

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
})
