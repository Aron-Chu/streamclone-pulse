import { describe, expect, it } from 'vitest'
import SUPPORTER_PERKS from '../src/shared/supporter-perks.json'

/**
 * The one Supporter perk list. The extension's offer, settings banner chips,
 * quick-settings card description and "Who sees what", and the website's
 * /supporter page and Terms, all render this file (the website imports it from
 * src/shared). Changing what Supporter includes is a deliberate edit here, and
 * the website copy tests pin the same text.
 */
describe('Supporter perk list', () => {
  it('names every perk the extension gives, in order', () => {
    expect(SUPPORTER_PERKS.names).toEqual(['Title paint', 'Tenure crest', 'Emote rain', 'Supporter card'])
    expect(Object.keys(SUPPORTER_PERKS.details)).toEqual(SUPPORTER_PERKS.names)
  })

  it('pins what each perk is', () => {
    expect(SUPPORTER_PERKS.details).toEqual({
      'Title paint': 'your Pulse panel title painted in a Glass, Etched or Halo finish, with the wave and sheen you pick.',
      'Tenure crest': 'a crest beside your painted title that levels up at 3, 6, 12 and 24 months of support.',
      'Emote rain': '7TV emotes behind your Pulse panel header, still or falling: the 7TV header backdrop.',
      'Supporter card': 'your own crest and paint on the Supporter card in quick settings and in settings, as private recognition for supporting.',
    })
    expect(SUPPORTER_PERKS.onlyYou).toBe('Only you see them, in your own StreamPulse extension. Nothing is added to chat, and nobody else sees them.')
  })

  it('says plainly that the 7TV header backdrop moved to Supporter in 0.2.2', () => {
    expect(SUPPORTER_PERKS.moved).toBe('Emote rain, the 7TV header backdrop, was free up to extension 0.2.1. From 0.2.2 it is a Supporter perk, and a backdrop you saved is kept for when you support. No other free feature moved behind Supporter.')
  })

  it('matches what the code gates: three finishes, the tenure ladder and the backdrop modes', async () => {
    const { SUPPORTER_FINISH_OPTIONS } = await import('../src/ui/supporterFinish.ts')
    const { SUPPORTER_TENURES } = await import('../src/shared/supporterPaint.ts')
    expect(SUPPORTER_FINISH_OPTIONS.map(option => option.label)).toEqual(['Glass', 'Etched', 'Halo'])
    expect(SUPPORTER_TENURES.map(option => option.months)).toEqual([0, 3, 6, 12, 24])
  })
})
