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
    expect(SUPPORTER_PERKS.names).toEqual(['Title paint', 'Tenure crest', 'Backdrop', 'Supporter card'])
    expect(Object.keys(SUPPORTER_PERKS.details)).toEqual(SUPPORTER_PERKS.names)
  })

  it('pins what each perk is', () => {
    expect(SUPPORTER_PERKS.details).toEqual({
      'Title paint': 'your Pulse panel title in Glass, Etched or Halo paint, still, shimmering or drifting.',
      'Tenure crest': 'a crest beside your Pulse panel title, under any paint. It levels up at 3, 6, 12 and 24 months.',
      'Backdrop': "original StreamPulse art behind your Pulse panel header, in your paint's colours, still or drifting.",
      'Supporter card': 'your crest and paint on your Supporter card in settings.',
    })
    expect(SUPPORTER_PERKS.onlyYou).toBe('Only you see these, in your own StreamPulse extension. Nothing is added to Twitch chat.')
  })

  it('has no claim that a perk moved from free for store users', () => {
    expect(SUPPORTER_PERKS).not.toHaveProperty('moved')
    expect(JSON.stringify(SUPPORTER_PERKS)).not.toMatch(/moved from free|was free up to|backdrop you saved/i)
  })

  it('matches what the code gates: three finishes, the tenure ladder and the backdrop modes', async () => {
    const { SUPPORTER_FINISH_OPTIONS } = await import('../src/ui/supporterFinish.ts')
    const { SUPPORTER_TENURES } = await import('../src/shared/supporterPaint.ts')
    expect(SUPPORTER_FINISH_OPTIONS.map(option => option.label)).toEqual(['Glass', 'Etched', 'Halo'])
    expect(SUPPORTER_TENURES.map(option => option.months)).toEqual([0, 3, 6, 12, 24])
  })
})
