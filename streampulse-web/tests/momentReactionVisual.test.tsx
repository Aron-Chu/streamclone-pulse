import React from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MomentReactionVisual } from '../src/ui/components/moments/MomentReactionVisual'
import type { DiscoveryMoment } from '../src/lib/discoveryMoments'

const moment: DiscoveryMoment = {
  key: 'creator:stream:60', login: 'creator', displayName: 'Creator', streamId: 'stream', offsetSeconds: 60,
  label: 'Emote spike', reactionSignal: 'emotes', emotesPerMin: 412, chatPerMin: 215,
  topEmotes: [{ name: 'SingsMic', provider: 'seventv', count: 349 }], provenance: 'hub',
}

afterEach(cleanup)

it('uses measured reaction evidence as a clearly non-video visual fallback', () => {
  const { container } = render(<MomentReactionVisual moment={moment} />)
  expect(screen.getByLabelText('Measured reaction snapshot for Creator; not a video preview')).toBeTruthy()
  expect(screen.getByText('412')).toBeTruthy()
  expect(screen.getByText('215')).toBeTruthy()
  expect(screen.getByText('Emotes / min')).toBeTruthy()
  expect(screen.getByText('Chat / min')).toBeTruthy()
  expect(screen.getByText('349 uses · 7TV')).toBeTruthy()
  expect(screen.getByText('Measured chat evidence · not footage')).toBeTruthy()
  expect(container.querySelector('iframe')).toBeNull()
  expect(screen.queryByRole('button')).toBeNull()
})

it('shows unavailable media without manufacturing measured evidence', () => {
  const { container } = render(<MomentReactionVisual moment={{ ...moment, chatPerMin: undefined, emotesPerMin: undefined, topEmotes: undefined }} />)
  expect(screen.getByLabelText('Preview unavailable')).toBeTruthy()
  expect(screen.queryByText('Chat / min')).toBeNull()
  expect(screen.queryByText('Emotes / min')).toBeNull()
  expect(container.querySelector('img, iframe, video')).toBeNull()
})

it('renders compact truthful message when rates are not available but emotes exist', () => {
  render(<MomentReactionVisual moment={{ ...moment, chatPerMin: undefined, emotesPerMin: undefined }} />)
  expect(screen.getByText('Aggregate chat and emote rates were not supplied for this archived detection.')).toBeTruthy()
  expect(screen.getByText('349 uses · 7TV')).toBeTruthy()
  expect(screen.queryByText('Chat / min')).toBeNull()
  expect(screen.queryByText('Emotes / min')).toBeNull()
})

it('renders explicit zero rates when measured', () => {
  render(<MomentReactionVisual moment={{ ...moment, chatPerMin: 0, emotesPerMin: 0 }} />)
  expect(screen.getAllByText('0')).toHaveLength(2)
  expect(screen.getByText('Chat / min')).toBeTruthy()
  expect(screen.getByText('Emotes / min')).toBeTruthy()
  expect(screen.queryByText('Aggregate chat and emote rates were not supplied for this archived detection.')).toBeNull()
})
