import type { SupporterCardMount } from '../supporter/cardContract.ts'
import { mountChatStack } from '../supporter/chatStack.ts'
import { SAMPLE_KIT, finishVars, type Kit } from '../supporter/kit.ts'

/**
 * Entry of `content/supporter-card.js`: the quick-settings Supporter card's
 * "Your Line" stage. The worker injects it into a Twitch tab only when the card
 * is shown; it registers one function in the extension's isolated world and
 * draws nothing by itself.
 *
 * A Supporter sees Tenure Climb with their own crest and paint; everyone else
 * sees Anatomy with the lab's sample kit. Nothing here reads storage: the
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
  const stop = mountChatStack(stage, { mode: options.mode, kit })
  return () => {
    stop()
    for (const [name] of vars) host?.style.removeProperty(name)
  }
}

globalThis.__pulseSupporterCard ??= mountSupporterCard
