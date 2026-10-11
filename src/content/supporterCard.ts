import { DEFAULT_SIGNATURE_EMOTE, SUPPORTER_SIGNATURE_KEY, normalizeSignatureEmote } from '../shared/supporterSignature.ts'
import type { SupporterCardMount } from '../supporter/cardContract.ts'
import { mountChatStack } from '../supporter/chatStack.ts'
import { SAMPLE_KIT, finishVars, type Kit } from '../supporter/kit.ts'

/**
 * Entry of `content/supporter-card.js`: the quick-settings Supporter card's
 * "Your Line" stage. The worker injects it into a Twitch tab only when the card
 * is shown; it registers one function in the extension's isolated world and
 * draws nothing by itself.
 *
 * A Supporter sees Tenure Climb with their own crest, paint and signature
 * emote; everyone else sees Anatomy with the lab's sample kit. The signature
 * emote is read here, and only for a verified Supporter (`tenure` is only ever
 * asked for with perks), so the lock follows the same membership check as
 * emote rain.
 */
export const mountSupporterCard: SupporterCardMount = (stage, options) => {
  const supporter = options.mode === 'tenure'
  const kit: Kit = supporter
    ? { name: 'you', finish: options.finish ?? null, tenure: options.tenure ?? 'new', emote: DEFAULT_SIGNATURE_EMOTE, paint: options.finish ? options.paint : undefined }
    : { ...SAMPLE_KIT }
  // The card's own glow, hover edge and "Explore/Manage Supporter" colour follow the kit's paint.
  const host = stage.closest<HTMLElement>('.pulse-settings-supporter-cta')
  const vars = Object.entries(finishVars(kit.finish))
  for (const [name, value] of vars) host?.style.setProperty(name, value)
  const card = mountChatStack(stage, { mode: options.mode, kit })
  let live = true
  const storage = globalThis.chrome?.storage
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'sync' && changes[SUPPORTER_SIGNATURE_KEY]) card.setEmote(normalizeSignatureEmote(changes[SUPPORTER_SIGNATURE_KEY].newValue))
  }
  if (supporter && storage) {
    void storage.sync.get(SUPPORTER_SIGNATURE_KEY)
      .then(stored => { if (live) card.setEmote(normalizeSignatureEmote(stored?.[SUPPORTER_SIGNATURE_KEY])) })
      .catch(() => { /* Keep the default emote. */ })
    storage.onChanged.addListener(changed)
  }
  return () => {
    live = false
    if (supporter) storage?.onChanged.removeListener(changed)
    card.stop()
    for (const [name] of vars) host?.style.removeProperty(name)
  }
}

globalThis.__pulseSupporterCard ??= mountSupporterCard
