import { useCallback, useEffect, useRef, useState } from 'react'
import type { BackgroundResponse } from '../shared/messages.ts'
import type { SupporterAccountAction, SupporterAccountState } from '../shared/supporterAccount.ts'
import { productLink } from '../shared/portalLinks.ts'
import { PulseSectionCard } from '../ui/PulseSectionCard.tsx'
import { usePortalOrigin } from './usePortalOrigin.ts'

const descriptions: Record<string, string> = {
  signed_out: 'Connect this extension to your Pulse account.',
  denied: 'The connection was declined. You can start again when ready.',
  expired: 'This code expired. Start again to get a new code.',
  relink_required: 'Your connection needs to be renewed. Link this extension again.',
  error: 'The account service could not be reached. Check your connection and try again.',
}
const unavailable: Record<Extract<SupporterAccountState, { state: 'unavailable' }>['reason'], string> = {
  not_deployed: 'Account linking is not available on the server yet. Your free tools still work.',
  temporarily_unavailable: 'The account service is temporarily unavailable. Your free tools still work; try again in a moment.',
}
const unrenewed = 'This extension is still connected, but the account service is temporarily unavailable. Your free tools still work; check again in a moment.'

/** The worker owns credentials and network requests; this page receives a safe projection. */
export function AccountConnection() {
  const [account, setAccount] = useState<SupporterAccountState | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const requestId = useRef(0)
  const inFlight = useRef(false)
  const portalOrigin = usePortalOrigin()
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
  useEffect(() => {
    void request('status')
    const changed = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('pulseAccountRevision' in changes) void request('status')
    }
    const storage = globalThis.chrome?.storage?.onChanged
    storage?.addListener(changed)
    return () => { requestId.current++; inFlight.current = false; storage?.removeListener(changed) }
  }, [request])
  const unrenewedLink = account?.state === 'unavailable' && account.linked === true
  // Linking is not deployed on this server, so offering "Link extension" would
  // only repeat the same failure. Show the explanation alone; reopening settings
  // checks again.
  const linkingNotDeployed = account?.state === 'unavailable' && account.reason === 'not_deployed' && !account.linked
  useEffect(() => {
    if (account?.state !== 'pending' || busy) return
    const timer = window.setTimeout(() => {
      void request(document.hidden ? 'status' : 'poll')
    }, Math.max(5, account.retryAfterSeconds) * 1000)
    return () => window.clearTimeout(timer)
  }, [account, busy, request])

  return <PulseSectionCard title="Pulse account" headingLevel={3}>
    <div role="status" aria-live="polite">
      {!account ? <p>Checking account connection…</p>
        : account.state === 'linked' ? <><p>This extension is connected.</p><p className="pulse-supporter-detail">This connection does not confirm a subscription or link your Twitch identity.</p></>
          : account.state === 'pending' ? <><p>Enter this code on the Pulse account page, then review the extension request.</p><p className="pulse-account-link-code">{account.code}</p><p className="pulse-supporter-detail">Waiting for your approval. The code expires at {new Date(account.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</p></>
            : account.state === 'unavailable' ? <p>{account.linked ? unrenewed : unavailable[account.reason]}</p>
              : <p>{account.state === 'error' && account.revocationPending ? 'Account access is stopped on this extension. Server revocation is pending; retry disconnect when connected.' : descriptions[account.state]}</p>}
      {notice ? <p>{notice}</p> : null}
    </div>
    {linkingNotDeployed ? null : <div className="pulse-account-link-actions">
      {account?.state === 'pending' ? <><a href={productLink('linkDevice', portalOrigin)} target="_blank" rel="noopener noreferrer">Open account page</a><button type="button" disabled={busy} onClick={() => void request('cancel')}>Cancel connection</button></>
        : account?.state === 'linked' || unrenewedLink ? <button type="button" disabled={busy} onClick={() => void request('disconnect')}>Disconnect extension</button>
          : account?.state === 'error' && account.revocationPending ? <button type="button" disabled={busy} onClick={() => void request('disconnect')}>Retry disconnect</button>
          : account ? <button type="button" disabled={busy} onClick={() => void request('start')}>{busy ? 'Connecting…' : 'Link extension'}</button> : null}
      {account?.state === 'error' || unrenewedLink ? <button type="button" disabled={busy} onClick={() => void request('status')}>Check connection</button> : null}
    </div>}
  </PulseSectionCard>
}
