import { useCallback, useEffect, useState } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
import type { BackgroundResponse } from '../shared/messages.ts'
import { CHAT_BADGE_LIST_STORAGE_KEY } from '../shared/chatBadges.ts'

export type ChatBadgeReply = Extract<BackgroundResponse, { type: 'SUPPORTER_CHAT_BADGE' }>

/**
 * Whether Seen in chat is live in this browser: a verified list arrived and
 * the server hasn't switched the feature off since (404). The viewer settings
 * and the perk appear only then. The third value says whether this build pins
 * a list key at all; a build without one never offers publishing your own entry.
 */
export function useChatBadgeListReceived(): [boolean, () => void, boolean] {
  const [received, setReceived] = useState(false)
  const [keysPinned, setKeysPinned] = useState(false)
  const read = useCallback(() => {
    void sendBackgroundMessage({ type: 'SUPPORTER_CHAT_BADGE', action: 'status' })
      .then(response => {
        const reply = response as ChatBadgeReply | undefined
        if (reply?.type !== 'SUPPORTER_CHAT_BADGE') return
        setReceived(reply.listReceived === true)
        setKeysPinned(reply.keysPinned === true)
      })
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    read()
    const event = globalThis.chrome?.storage?.onChanged
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && CHAT_BADGE_LIST_STORAGE_KEY in changes) read()
    }
    event?.addListener(changed)
    return () => { event?.removeListener(changed) }
  }, [read])
  return [received, read, keysPinned]
}
