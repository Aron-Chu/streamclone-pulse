/**
 * Privacy's Twitch item says when the session page loads Twitch's player (11-22): paused once a minute is picked on a
 * larger screen with a mouse or trackpad, unless data saver is on; otherwise only on Play
 * (MomentVodPanel `vodAutoPreviewAllowed`).
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import Privacy from '../src/routes/public/Privacy'

describe('Privacy: Twitch player on session pages', () => {
  it('says when the player loads from Twitch', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    const twitch = (screen.getByTestId('privacy-third-party-twitch').textContent ?? '').replace(/\s+/g, ' ')
    expect(twitch).toContain(
      "On a session page, picking a minute on a larger screen with a mouse or trackpad loads Twitch's player from Twitch, paused, unless data saver is on. Otherwise it loads only when you press Play.",
    )
    // the follows sentence before it is unchanged
    expect(twitch).toContain("StreamPulse's servers are not involved.")
  })

  it('says when the front page loads a channel chat from Twitch', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    const twitch = (screen.getByTestId('privacy-third-party-twitch').textContent ?? '').replace(/\s+/g, ' ')
    expect(twitch).toContain(
      "On the front page, pointing at a chat on a larger screen with a mouse or trackpad loads that channel's chat from Twitch, unless data saver is on.",
    )
  })
})
