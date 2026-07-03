import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

// Mirror FigmaChannelDashboard top-emote row rules (imageUrl-first, graceful fallback).

function ChannelTopEmoteRow({
  name,
  imageUrl,
}: {
  name: string
  imageUrl?: string
}) {
  return (
    <li>
      {imageUrl ? <img src={imageUrl} alt="" data-testid="emote-img" /> : null}
      <strong>{name}</strong>
    </li>
  )
}

describe('channel emote thumbnails', () => {
  it('renders imageUrl when backend provides a public CDN url', () => {
    render(
      <ul>
        <ChannelTopEmoteRow
          name="xqcL"
          imageUrl="https://static-cdn.jtvnw.net/emoticons/v2/1035663/default/dark/2.0"
        />
      </ul>,
    )
    const img = screen.getByTestId('emote-img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe(
      'https://static-cdn.jtvnw.net/emoticons/v2/1035663/default/dark/2.0',
    )
  })

  it('falls back to name-only row when imageUrl is absent', () => {
    render(
      <ul>
        <ChannelTopEmoteRow name="KEKW" />
      </ul>,
    )
    expect(screen.queryByTestId('emote-img')).toBeNull()
    expect(screen.getByText('KEKW')).toBeTruthy()
  })
})
