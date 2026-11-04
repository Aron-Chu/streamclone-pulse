import { useEffect } from 'react'
import { useAccountSession } from '../../lib/accountSession'
import { dismissAccountSavesToast, settleSignedOutSaves, startAccountSaves, syncAccountSaves, useAccountSaves } from '../../lib/accountSaves'
import './AccountSync.css'

const TOAST_MS = 10_000
const quietly = () => undefined

/**
 * Keeps this browser's saves in step with the signed-in account (accountSaves.ts),
 * and shows the one toast that says what moved on sign-in. Mounted once, with
 * the routes, when My Moments is on (VITE_ACCOUNT_MOMENTS=1).
 */
export function AccountSync() {
  const session = useAccountSession()
  const { toast } = useAccountSaves()
  useEffect(() => { startAccountSaves() }, [])
  useEffect(() => {
    if (session.status === 'signed_in') void syncAccountSaves({ force: true }).catch(quietly)
    else if (session.status === 'signed_out') settleSignedOutSaves()
  }, [session])
  useEffect(() => {
    if (session.status !== 'signed_in') return
    const onReturn = () => { if (document.visibilityState !== 'hidden') void syncAccountSaves().catch(quietly) }
    window.addEventListener('focus', onReturn)
    window.addEventListener('online', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      window.removeEventListener('focus', onReturn)
      window.removeEventListener('online', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [session.status])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(dismissAccountSavesToast, TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [toast])
  return toast ? <div className="account-saves-toast" role="status">
    <span aria-hidden="true">✓</span><span>{toast}</span>
    <button type="button" aria-label="Dismiss" onClick={dismissAccountSavesToast}>✕</button>
  </div> : null
}
