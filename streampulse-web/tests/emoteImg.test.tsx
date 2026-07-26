import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { EmoteImg } from '../src/ui/components/analytics/EmoteImg'

vi.mock('../src/lib/apiClient', () => ({
  getBackendUrl: () => 'https://api.streampulse.stream',
}))

describe('EmoteImg', () => {
  it('falls back to text when the image fails to load', () => {
    const { container } = render(
      <EmoteImg src="https://cdn.7tv.app/emote/missing/1x.webp" name="KEKW" />,
    )
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    fireEvent.error(img as HTMLImageElement)
    expect(screen.getByText('K')).toBeTruthy()
  })

  it('does not render img for disallowed hosts', () => {
    const { container } = render(<EmoteImg src="https://evil.example/x.webp" name="KEKW" />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('K')).toBeTruthy()
  })

  it('sets 7TV src to 1x and srcset with 1x/2x/4x', () => {
    const { container } = render(
      <EmoteImg src="https://cdn.7tv.app/emote/abc/4x.webp" name="Wide" width={28} />,
    )
    const img = container.querySelector('img') as HTMLImageElement
    expect(img.src).toBe('https://cdn.7tv.app/emote/abc/1x.webp')
    expect(img.srcset).toContain('1x.webp 1x')
    expect(img.srcset).toContain('2x.webp 2x')
    expect(img.srcset).toContain('4x.webp 4x')
  })

  it('sets Twitch srcset with scaled CDN paths', () => {
    const { container } = render(
      <EmoteImg
        src="https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0"
        name="Kappa"
        width={28}
      />,
    )
    const img = container.querySelector('img') as HTMLImageElement
    expect(img.src).toContain('/1.0')
    expect(img.srcset).toContain('1x')
    expect(img.srcset).toContain('2x')
  })

  it('sets FFZ srcset with 1/2/4 scales', () => {
    const { container } = render(
      <EmoteImg src="https://cdn.frankerfacez.com/emote/12345/4" name="FFZ" width={28} />,
    )
    const img = container.querySelector('img') as HTMLImageElement
    expect(img.src).toContain('/1')
    expect(img.srcset).toContain('/1 1x')
    expect(img.srcset).toContain('/4 4x')
  })
})
