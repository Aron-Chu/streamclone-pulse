import { useEffect, useState } from 'react'
import { DEFAULT_SIGNATURE_EMOTE, SUPPORTER_SIGNATURE_KEY, getSignatureEmote, normalizeSignatureEmote, setSignatureEmote, type SignatureEmote } from '../shared/supporterSignature.ts'

/** The stored signature emote (the default until one is picked), following changes from other pages. */
export function useSignatureEmote() {
  const [value, setValue] = useState<SignatureEmote>(DEFAULT_SIGNATURE_EMOTE)
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState('')
  useEffect(() => {
    let alive = true
    void getSignatureEmote()
      .then(next => { if (alive) setValue(next) })
      .catch(() => { /* Keep the default. */ })
      .finally(() => { if (alive) setReady(true) })
    const changes = globalThis.chrome?.storage?.onChanged
    const listener = (items: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'sync' && items[SUPPORTER_SIGNATURE_KEY]) setValue(normalizeSignatureEmote(items[SUPPORTER_SIGNATURE_KEY].newValue))
    }
    changes?.addListener(listener)
    return () => { alive = false; changes?.removeListener(listener) }
  }, [])
  /** Only a Supporter can change it; otherwise nothing is written. */
  async function choose(perks: boolean, next: SignatureEmote) {
    setStatus('')
    if (!perks) return
    const previous = value
    setValue(next)
    try {
      if (!await setSignatureEmote(perks, next)) throw new Error('refused')
      setStatus('Signature emote saved.')
    } catch {
      setValue(previous)
      setStatus('Could not save your signature emote. Please try again.')
    }
  }
  return { value, ready, status, choose }
}
