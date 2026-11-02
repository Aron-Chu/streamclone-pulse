import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { AccountFooter } from './AccountFooter'
import { TwitchErrorNotice, TwitchGlitch } from './TwitchSignIn'
import { completeTwitchCallback, type TwitchCompletion } from '../../lib/twitchSignIn'
import './account.css'

/**
 * /account/twitch/callback. By the time this renders, twitchCallbackBoot.ts
 * has already removed the token from the URL; this page only finishes the
 * flow, refreshes the shared session, and moves on (or explains what failed).
 */
export default function AccountTwitchCallback() {
  const navigate = useNavigate()
  const [failure, setFailure] = useState<Extract<TwitchCompletion, { status: 'error' }> | null>(null)
  useEffect(() => {
    let live = true
    void completeTwitchCallback().then(outcome => {
      if (!live) return
      if (outcome.status === 'error') setFailure(outcome)
      else navigate(outcome.returnTo, { replace: true, state: { twitch: outcome.status } })
    })
    return () => { live = false }
  }, [navigate])
  return <PublicLayout><section className="pulse-account" aria-label="StreamPulse account">
    <p className="pulse-account-kicker"><TwitchGlitch size={16} /> {failure?.purpose === 'link' ? 'Link Twitch' : 'Sign in with Twitch'}</p>
    {failure ? <TwitchErrorNotice page code={failure.code} purpose={failure.purpose} />
      : <><h1>Finishing up…</h1><p role="status">Checking your Twitch sign-in with StreamPulse.</p></>}
    <AccountFooter />
  </section></PublicLayout>
}
