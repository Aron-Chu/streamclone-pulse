import type { SupporterPaintStyle, SupporterTenure } from '../shared/supporterPaint.ts'

/**
 * The quick-settings Supporter card draws its stage from a separate script,
 * `content/supporter-card.js`, so the lab port never ships in the size-gated
 * Twitch content script. The card asks the worker to inject that script into
 * its own tab (the extension's isolated world, which content scripts share),
 * then calls the function it registers.
 *
 * Only types live here, so the content script imports nothing from it at run time.
 */
export interface SupporterCardOptions {
  /** `tenure` (Tenure Climb) for a verified Supporter, `anatomy` for everyone else. */
  mode: 'anatomy' | 'tenure'
  /** The crest the server reports for this Supporter. */
  tenure?: SupporterTenure
  finish?: 'glass' | 'etched' | 'halo' | null
  paint?: SupporterPaintStyle
}

/** Draws the card's stage; returns its cleanup. */
export type SupporterCardMount = (stage: HTMLElement, options: SupporterCardOptions) => () => void

declare global {
  // Registered by content/supporter-card.js in the extension's isolated world.
  // eslint-disable-next-line no-var
  var __pulseSupporterCard: SupporterCardMount | undefined
}
