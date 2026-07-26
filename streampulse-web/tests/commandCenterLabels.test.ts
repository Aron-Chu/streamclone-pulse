import { describe, expect, it } from 'vitest'
import {
  COMMAND_CENTER_LABELS,
  sidebarLabelFor,
} from '../src/ui/themes/commandCenterLabels'

describe('commandCenterLabels', () => {
  it('exports readable hub copy', () => {
    expect(COMMAND_CENTER_LABELS.pulseMoments).toBe('Pulse Moments')
    expect(COMMAND_CENTER_LABELS.liveRail).toBe('Hottest live')
    expect(COMMAND_CENTER_LABELS.emoteSignal).toBe('Emote Market')
    expect(COMMAND_CENTER_LABELS.trackedChannels).toBe('Channel Screener')
    expect(COMMAND_CENTER_LABELS.searchPlaceholder).toBe('Search channels…')
  })

  it('maps sidebar section ids', () => {
    expect(sidebarLabelFor('section-pulse-moments', COMMAND_CENTER_LABELS, 'fallback')).toBe(
      'Pulse Moments',
    )
    expect(sidebarLabelFor('unknown', COMMAND_CENTER_LABELS, 'fallback')).toBe('fallback')
  })
})
