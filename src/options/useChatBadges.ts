import { useCallback, useEffect, useState } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
import type { BackgroundResponse } from '../shared/messages.ts'

export type ChatBadgeReply = Extract<BackgroundResponse, { type: 'SUPPORTER_CHAT_BADGE' }>

/**
 * Whether this browser has received a valid Seen in chat list: the feature is
 * live on the server. The viewer settings and the perk appear only then.
 */
export function useChatBadgeListReceived(): [boolean, () => void] {
  const [received, setReceived] = useState(false)
  const read = useCallback(() => {
    void sendBackgroundMessage({ type: 'SUPPORTER_CHAT_BADGE', action: 'status' })
      .then(response => {
        const reply = response as ChatBadgeReply | undefined
        if (reply?.type === 'SUPPORTER_CHAT_BADGE') setReceived(reply.listReceived === true)
      })
      .catch(() => undefined)
  }, [])
  useEffect(() => { read() }, [read])
  return [received, read]
}
