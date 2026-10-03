import { useCallback, useEffect, useRef, useState } from 'react'
import type { BackgroundResponse } from '../shared/messages.ts'
import type { SupporterAccountAction, SupporterAccountState } from '../shared/supporterAccount.ts'

export interface AccountConnectionModel {
  account: SupporterAccountState | null
  busy: boolean
  notice: string
  request: (action: SupporterAccountAction) => Promise<void>
  /** Show a state the worker returned through another message, superseding any request in flight. */
  apply: (account: SupporterAccountState) => void
}

/** The worker owns credentials and network requests; this page receives a safe projection. */
export function useAccountConnection(): AccountConnectionModel {
  const [account, setAccount] = useState<SupporterAccountState | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const requestId = useRef(0)
  const inFlight = useRef(false)
  const request = useCallback(async (action: SupporterAccountAction) => {
    if (inFlight.current) return
    inFlight.current = true
    const id = ++requestId.current
    setBusy(true)
    setNotice('')
    try {
      const response: BackgroundResponse = await chrome.runtime.sendMessage({ type: 'SUPPORTER_ACCOUNT', action })
      if (id !== requestId.current) return
      if (!response || !('type' in response) || response.type !== 'SUPPORTER_ACCOUNT') throw new Error('Account worker unavailable')
      setAccount(response.account)
      if (action === 'disconnect' && response.account.state === 'error') {
        setNotice('Disconnect did not finish cleanly; server revocation could not be confirmed. Check the connection before trying again.')
      }
    } catch {
      if (id === requestId.current) {
        setAccount({ state: 'error' })
        if (action === 'disconnect') setNotice('Disconnect could not be confirmed. Try again when the extension is available.')
      }
    } finally {
      if (id === requestId.current) { inFlight.current = false; setBusy(false) }
    }
  }, [])
  const apply = useCallback((next: SupporterAccountState) => {
    requestId.current++
    inFlight.current = false
    setBusy(false)
    setNotice('')
    setAccount(next)
  }, [])
  useEffect(() => {
    void request('status')
    const changed = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('pulseAccountRevision' in changes) void request('status')
    }
    const storage = globalThis.chrome?.storage?.onChanged
    storage?.addListener(changed)
    return () => { requestId.current++; inFlight.current = false; storage?.removeListener(changed) }
  }, [request])
  useEffect(() => {
    if (account?.state !== 'pending' || busy) return
    const timer = window.setTimeout(() => {
      void request(document.hidden ? 'status' : 'poll')
    }, Math.max(5, account.retryAfterSeconds) * 1000)
    return () => window.clearTimeout(timer)
  }, [account, busy, request])
  return { account, busy, notice, request, apply }
}
