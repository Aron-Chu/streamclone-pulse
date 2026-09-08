import React from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MomentArchiveArtwork } from '../src/ui/components/moments/MomentArchiveArtwork'
const artwork = { vodId: '123', kind: 'archive_thumbnail' as const, url: 'https://static-cdn.jtvnw.net/cf_vods/example/thumb/thumb0.jpg' }
afterEach(cleanup)
it('labels archive art honestly without embedding a player or separate action', () => {
  const { container } = render(<MomentArchiveArtwork artwork={artwork} />)
  expect(screen.getByText('Broadcast thumbnail · not the moment frame')).toBeTruthy()
  expect(container.querySelector('iframe')).toBeNull()
  expect(container.querySelector('img')?.getAttribute('loading')).toBe('lazy')
  expect(screen.queryByRole('button')).toBeNull()
})
it('removes failed imagery and recovers for a replacement URL', () => {
  const { container, rerender } = render(<MomentArchiveArtwork artwork={artwork} />)
  fireEvent.error(container.querySelector('img')!)
  expect(container.querySelector('img')).toBeNull()
  rerender(<MomentArchiveArtwork artwork={{ ...artwork, url: artwork.url.replace('thumb0', 'thumb1') }} />)
  expect(container.querySelector('img')).toBeTruthy()
})
it('does not request live or untrusted artwork', () => {
  const { container } = render(<MomentArchiveArtwork artwork={{ ...artwork, url: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_dona.jpg' }} />)
  expect(container.querySelector('img')).toBeNull()
})
it('shows fallback evidence after image failure and clears it for replacement artwork', () => {
  const fallback = <span>Measured reaction evidence</span>
  const { container, rerender } = render(<MomentArchiveArtwork artwork={artwork} fallback={fallback} />)
  expect(screen.queryByText('Measured reaction evidence')).toBeNull()
  fireEvent.error(container.querySelector('img')!)
  expect(screen.getByText('Measured reaction evidence')).toBeTruthy()
  expect(screen.queryByText('Broadcast thumbnail · not the moment frame')).toBeNull()
  rerender(<MomentArchiveArtwork artwork={{ ...artwork, url: artwork.url.replace('thumb0', 'thumb1') }} fallback={fallback} />)
  expect(container.querySelector('img')).toBeTruthy()
  expect(screen.queryByText('Measured reaction evidence')).toBeNull()
})
it('shows fallback without requesting rejected imagery', () => {
  const { container } = render(<MomentArchiveArtwork artwork={{ ...artwork, url: 'https://example.com/frame.jpg' }} fallback={<span>Preview unavailable</span>} />)
  expect(container.querySelector('img')).toBeNull()
  expect(screen.getByText('Preview unavailable')).toBeTruthy()
})
