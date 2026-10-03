import type { SupporterAccountState } from '../shared/supporterAccount.ts'
import { deviceLinkWithCode } from '../shared/portalLinks.ts'
import { TWITCH_SIGNIN_ENABLED } from '../shared/twitchSignIn.ts'
import { PulseSectionCard } from '../ui/PulseSectionCard.tsx'
import { TwitchAccountConnection } from './TwitchAccountConnection.tsx'
import { useAccountConnection, type AccountConnectionModel } from './useAccountConnection.ts'
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

/**
 * The "Pulse account" card. With Sign in with Twitch off (the build default)
 * it is the device-code card; with it on, the Twitch card, which falls back to
 * the device-code card where the browser has no identity API.
 */
export function AccountConnection({ twitchSignIn = TWITCH_SIGNIN_ENABLED }: { twitchSignIn?: boolean } = {}) {
  const connection = useAccountConnection()
  return twitchSignIn
    ? <TwitchAccountConnection connection={connection} fallback={<DeviceLinkCard connection={connection} />} />
    : <DeviceLinkCard connection={connection} />
}

/** Device-code linking: the original account card. */
export function DeviceLinkCard({ connection }: { connection: AccountConnectionModel }) {
  const { account, busy, notice, request } = connection
  const portalOrigin = usePortalOrigin()
  const unrenewedLink = account?.state === 'unavailable' && account.linked === true
  // Linking is not deployed on this server, so offering "Link extension" would
  // only repeat the same failure. Show the explanation alone; reopening settings
  // checks again.
  const linkingNotDeployed = account?.state === 'unavailable' && account.reason === 'not_deployed' && !account.linked

  return <PulseSectionCard title="Pulse account" headingLevel={3}>
    <div role="status" aria-live="polite">
      {!account ? <p>Checking account connection…</p>
        : account.state === 'linked' ? <><p>This extension is connected.</p><p className="pulse-supporter-detail">This connection does not confirm a subscription or link your Twitch identity.</p></>
          : account.state === 'pending' ? <><p>Open the Pulse account page with this code prepared, then choose Review extension and Approve extension. You can also enter the code yourself.</p><p className="pulse-account-link-code">{account.code}</p><p className="pulse-supporter-detail">Waiting for your approval. The code expires at {new Date(account.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</p></>
            : account.state === 'unavailable' ? <p>{account.linked ? unrenewed : unavailable[account.reason]}</p>
              : <p>{account.state === 'error' && account.revocationPending ? 'Account access is stopped on this extension. Server revocation is pending; retry disconnect when connected.' : descriptions[account.state]}</p>}
      {notice ? <p>{notice}</p> : null}
    </div>
    {linkingNotDeployed ? null : <div className="pulse-account-link-actions">
      {account?.state === 'pending' ? <><a href={deviceLinkWithCode(account.code, portalOrigin)} target="_blank" rel="noopener noreferrer">Open account page</a><button type="button" disabled={busy} onClick={() => void request('cancel')}>Cancel connection</button></>
        : account?.state === 'linked' || unrenewedLink ? <button type="button" disabled={busy} onClick={() => void request('disconnect')}>Disconnect extension</button>
          : account?.state === 'error' && account.revocationPending ? <button type="button" disabled={busy} onClick={() => void request('disconnect')}>Retry disconnect</button>
          : account ? <button type="button" disabled={busy} onClick={() => void request('start')}>{busy ? 'Connecting…' : 'Link extension'}</button> : null}
      {account?.state === 'error' || unrenewedLink ? <button type="button" disabled={busy} onClick={() => void request('status')}>Check connection</button> : null}
    </div>}
  </PulseSectionCard>
}
