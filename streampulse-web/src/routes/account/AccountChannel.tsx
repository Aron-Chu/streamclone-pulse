import { useEffect, useId, useState } from 'react'
import { accountErrorText } from '../../lib/accountApi'
import { readAccountChannel, removeAccountChannel, type AccountChannel } from '../../lib/channelOptIn'
import { beginTwitchFlow, twitchErrorCode, twitchErrorCopy } from '../../lib/twitchSignIn'

/**
 * "Add to my channel" (★ A1 on the IRC past 1,000 board, local sandbox
 * 2026-11-01): a streamer signed in with Twitch adds StreamPulse to their own
 * channel, and the API reads that chat over EventSub. The card copies the
 * board mock; the added and taken-back states are new.
 */
export function AccountChannelCard() {
  const [channel, setChannel] = useState<AccountChannel | null | 'loading' | 'hidden'>('loading')
  const [busy, setBusy] = useState<'' | 'add' | 'remove'>('')
  const [explain, setExplain] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const headingId = useId()
  const howId = useId()
  useEffect(() => {
    let live = true
    // Without an answer (no chat lane behind the API) there is nothing to offer.
    readAccountChannel().then(value => { if (live) setChannel(value) }, () => { if (live) setChannel('hidden') })
    return () => { live = false }
  }, [])
  if (channel === 'loading' || channel === 'hidden') return null

  async function add() {
    if (busy) return
    setBusy('add'); setError(''); setNotice('')
    try { await beginTwitchFlow({ purpose: 'channel' }) }
    catch (failure) { setError(twitchErrorCopy(twitchErrorCode(failure), 'channel').body); setBusy('') }
  }
  async function remove() {
    if (busy) return
    setBusy('remove'); setError(''); setNotice('')
    try {
      await removeAccountChannel()
      setChannel(null)
      setNotice('Removed. StreamPulse stopped counting your chat.')
    } catch (failure) { setError(accountErrorText(failure)) }
    finally { setBusy('') }
  }
  const added = channel?.status === 'active'
  return <section className="account-home__block account-channel" aria-labelledby={headingId}>
    <h2 id={headingId}>Live stats for your channel</h2>
    {added ? <p className="account-channel__text">Added: we count chat in <b>{channel.login}</b> every minute while you’re live.</p>
      : channel?.status === 'revoked' ? <p className="account-channel__text">Twitch took back the permission, so we stopped counting chat in <b>{channel.login}</b>. Add it again any time.</p>
        : <p className="account-channel__text">Add StreamPulse and we count your chat every minute: Moments, top emotes, session recaps.</p>}
    <div className="account-channel__actions">
      {added ? <button type="button" className="account-channel__button account-channel__ghost" disabled={busy !== ''} onClick={() => void remove()}>{busy === 'remove' ? 'Removing…' : 'Remove'}</button>
        : <>
          <button type="button" className="account-channel__button" disabled={busy !== ''} onClick={() => void add()}>{busy === 'add' ? 'Opening Twitch…' : 'Add to my channel'}</button>
          <button type="button" className="account-channel__button account-channel__ghost" aria-expanded={explain} aria-controls={howId} onClick={() => setExplain(open => !open)}>How it works</button>
        </>}
    </div>
    {explain && !added ? <ol id={howId} className="account-channel__how">
      <li>Twitch asks you to let StreamPulse’s bot read chat in your channel. It never posts.</li>
      <li>While you’re live, we count your chat every minute.</li>
      <li>Your Moments, top emotes and session recaps show on StreamPulse.</li>
    </ol> : null}
    <p className="account-channel__fine">{added
      ? 'We only read chat and never post. Remove stops the counting here; to take back the permission too, go to Twitch settings → Connections.'
      : 'We only read chat and never post. Remove us any time in Twitch settings → Connections.'}</p>
    <p className="account-home__feedback" role="status">{notice}</p>
    {error ? <p className="account-home__error" role="alert">{error}</p> : null}
  </section>
}
