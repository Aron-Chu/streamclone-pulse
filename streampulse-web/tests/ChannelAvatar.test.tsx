import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChannelAvatar } from '../src/ui/components/analytics/ChannelAvatar'

describe('ChannelAvatar', () => {
  it('falls back to initials when an image fails and retries a new source', () => {
    const view = render(
      <ChannelAvatar
        login="caedrel"
        name="Caedrel"
        src="https://cdn.example/old-avatar.png"
        alt="Caedrel avatar"
      />,
    )

    fireEvent.error(screen.getByRole('img'))

    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('C')).toBeTruthy()

    view.rerender(
      <ChannelAvatar
        login="caedrel"
        name="Caedrel"
        src="https://cdn.example/new-avatar.png"
        alt="Caedrel avatar"
      />,
    )

    expect(screen.getByRole('img').getAttribute('src')).toBe('https://cdn.example/new-avatar.png')
  })
})
