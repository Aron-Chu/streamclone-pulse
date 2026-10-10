import type { SupporterCardMount } from '../supporter/cardContract.ts'
import { mountEmotePile } from '../supporter/emotePile.ts'
import { SAMPLE_KIT, finishVars, type Kit } from '../supporter/kit.ts'
import { CARD_PILE_CSS } from '../supporter/styles.ts'

/**
 * Entry of `content/supporter-card.js`: the quick-settings Supporter card's
 * moving stage. The worker injects it into a Twitch tab only when the card is
 * shown; it registers one function in the extension's isolated world and
 * draws nothing by itself.
 *
 * The stage is the settings banner's Crown pile: emotes drop and stack, and
 * every so often a crest lands on top with a painted "you" tag. It shows the
 * perks on their own, never as a line in a Twitch chat column, because
 * nothing a Supporter has is added to chat.
 *
 * A Supporter (`tenure` mode) sees their own crest and paint; everyone else
 * (`anatomy` mode) sees the lab's sample kit. Nothing here reads storage: the
 * crest and paint arrive with the call, from the worker's verified reply.
 */
export const mountSupporterCard: SupporterCardMount = (stage, options) => {
  const kit: Kit = options.mode === 'tenure'
    ? { name: 'you', finish: options.finish ?? null, tenure: options.tenure ?? 'new', paint: options.finish ? options.paint : undefined }
    : { ...SAMPLE_KIT }
  // The card's own glow, hover edge and "Explore/Manage Supporter" colour follow the kit's paint.
  const host = stage.closest<HTMLElement>('.pulse-settings-supporter-cta')
  const vars = Object.entries(finishVars(kit.finish))
  for (const [name, value] of vars) host?.style.setProperty(name, value)
  const stop = mountEmotePile(stage, kit, CARD_PILE_CSS)
  return () => {
    stop()
    for (const [name] of vars) host?.style.removeProperty(name)
  }
}

globalThis.__pulseSupporterCard ??= mountSupporterCard
