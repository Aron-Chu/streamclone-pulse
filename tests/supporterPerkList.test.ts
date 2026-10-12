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
    expect(SUPPORTER_PERKS.names).toEqual(['Title paint', 'Tenure crest', '7TV emote backdrop', 'Supporter card'])
    expect(Object.keys(SUPPORTER_PERKS.details)).toEqual(SUPPORTER_PERKS.names)
  })

  it('pins what each perk is', () => {
    expect(SUPPORTER_PERKS.details).toEqual({
      'Title paint': 'your Pulse panel title painted in a Glass, Etched or Halo finish, with the wave and sheen you pick.',
      'Tenure crest': 'a crest beside your painted title that levels up at 3, 6, 12 and 24 months of support.',
      // The emotes fall behind the whole panel, not only its header.
      '7TV emote backdrop': '7TV emotes behind your Pulse panel, still or falling.',
      'Supporter card': 'your own crest and paint on the Supporter card in quick settings and in settings, as private recognition for supporting.',
    })
    expect(SUPPORTER_PERKS.onlyYou).toBe('Only you see them, in your own StreamPulse extension. Nothing is added to chat, and nobody else sees them.')
  })

  it('says plainly that the 7TV emote backdrop stays free until Supporter sign-ups open', () => {
    expect(SUPPORTER_PERKS.moved).toBe('The 7TV emote backdrop stays free until Supporter sign-ups open, then becomes a Supporter perk. A backdrop you saved is kept for when you support. No other free feature moves behind Supporter.')
  })

  it('matches what the code gates: three finishes, the tenure ladder and the backdrop modes', async () => {
    const { SUPPORTER_FINISH_OPTIONS } = await import('../src/ui/supporterFinish.ts')
    const { SUPPORTER_TENURES } = await import('../src/shared/supporterPaint.ts')
    expect(SUPPORTER_FINISH_OPTIONS.map(option => option.label)).toEqual(['Glass', 'Etched', 'Halo'])
    expect(SUPPORTER_TENURES.map(option => option.months)).toEqual([0, 3, 6, 12, 24])
  })
})
