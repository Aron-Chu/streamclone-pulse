import { useEffect, useId, useState } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
import { CHAT_BADGE_CONSENT_VERSION, type ChatBadgeActionError } from '../shared/chatBadges.ts'
import type { SupporterEntitlement } from '../shared/supporterAccount.ts'
import { PulseSectionCard } from '../ui/PulseSectionCard.tsx'
import { TwitchGlitch } from './TwitchAccountConnection.tsx'
import type { ChatBadgeReply } from './useChatBadges.ts'

/**
 * The consent panel, word for word. CHAT_BADGE_CONSENT_VERSION pins this text
 * (tests compare both): a material change to it bumps the version, and the
 * server then asks Supporters who agreed to the old text to turn it on again.
 */
export const CHAT_BADGE_CONSENT_COPY = {
  heading: 'Show your crest and paint in chat?',
  points: [
    'Other people who use the StreamPulse extension will see your crest beside your name in Twitch chat, and your name in your paint.',
    'To do this, StreamPulse publishes a public list with your Twitch username, your Twitch user ID, your crest level (it shows roughly how long you’ve supported) and your paint. Anyone can download this list.',
    'Twitch chat itself doesn’t change. People without StreamPulse see normal chat, and nothing is sent to Twitch.',
    'StreamPulse never learns which channels you or anyone else watches. Each extension downloads the whole list and adds crests on its own computer.',
    'You can turn it off any time. Your entry leaves the list within about an hour, and StreamPulse deletes the Twitch user ID and username it stored for this. It also leaves if your membership ends, you disconnect StreamPulse in your Twitch settings, or you delete your account.',
  ],
  confirmTwitch: 'You’ll confirm with Twitch that it’s your account.',
  accept: 'Continue with Twitch and turn on',
  decline: 'Not now',
  version: CHAT_BADGE_CONSENT_VERSION,
} as const

export const CHAT_BADGE_COPY = {
  switchLabel: 'Show my crest and paint to other StreamPulse viewers in chat',
  off: 'Off. Only you see your crest and paint.',
  turnedOff: 'Off. Your entry leaves the list within about an hour.',
  on: (login: string | undefined) => `On. Other StreamPulse viewers see your crest and paint next to ${login ? `@${login}` : 'your name'} in chat.`,
  onLatency: 'Changes reach other viewers within about an hour.',
  waiting: 'On. Waiting for Twitch to confirm your username — your crest appears in chat once it does.',
  paused: 'Paused while your membership is inactive. If you support again within 30 days it comes back on its own; after that, turn it on again.',
  needsTwitch: 'Seen in chat needs Continue with Twitch.',
  renew: 'Turn on again to keep showing: what Seen in chat shares has been updated.',
  turnOff: 'Turn off',
  nothingChanged: 'Nothing changed.',
} as const

export const CHAT_BADGE_ERRORS: Partial<Record<ChatBadgeActionError, string>> = {
  identity_mismatch: 'That Twitch account isn’t the one signed in here. Use the same Twitch account.',
  supporter_required: 'Seen in chat is for active Supporters.',
  cancelled: CHAT_BADGE_COPY.nothingChanged,
}
const FALLBACK_ERROR = 'Couldn’t turn it on right now. Nothing changed. Try again in a moment.'
const OFF_ERROR = 'Couldn’t turn it off right now. Try again in a moment.'

type Local = { own: 'on' | 'off'; login?: string } | null

/**
 * "In chat": Seen in chat for your own Twitch name. Shown only when the server
 * reports the feature (`chatBadge` in the Supporter snapshot) and you are, or
 * were recently, a Supporter. Turning it on needs a fresh Twitch check and the
 * consent above; turning it off is one click. Nothing here grants anything:
 * the server decides what is published.
 */
export function SupporterChatBadgeControls({ entitlement }: { entitlement: SupporterEntitlement | null }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [local, setLocal] = useState<Local>(null)
  const switchId = useId()
  const ready = entitlement?.state === 'ready' ? entitlement : null
  const badge = ready?.chatBadge
  const serverKey = badge ? `${badge.state}:${badge.login ?? ''}` : ''
  // A fresh server read replaces what this card assumed after its own action.
  useEffect(() => { setLocal(null) }, [serverKey])
  if (!ready || !badge) return null
  const supporter = ready.status === 'active' || ready.status === 'grace'
  if (!supporter && badge.state === 'off') return null

  const outdated = badge.state === 'on' && badge.consentVersion !== undefined && badge.consentVersion < CHAT_BADGE_CONSENT_VERSION
  const own = local?.own ?? (badge.state === 'off' || outdated ? 'off' : 'on')
  const login = local?.login ?? badge.login
  const disabled = !badge.available || busy

  async function act(action: 'on' | 'off') {
    setBusy(true)
    setNotice('')
    try {
      const reply = await sendBackgroundMessage({ type: 'SUPPORTER_CHAT_BADGE', action }) as ChatBadgeReply | undefined
      if (reply?.type === 'SUPPORTER_CHAT_BADGE' && reply.ok) {
        setLocal({ own: action, ...(reply.login ? { login: reply.login } : {}) })
        setConfirming(false)
      } else {
        const error = reply?.type === 'SUPPORTER_CHAT_BADGE' ? reply.error : undefined
        setNotice(action === 'off' ? OFF_ERROR : (error && CHAT_BADGE_ERRORS[error]) || FALLBACK_ERROR)
        if (error === 'cancelled') setConfirming(false)
      }
    } catch {
      setNotice(action === 'off' ? OFF_ERROR : FALLBACK_ERROR)
    } finally {
      setBusy(false)
    }
  }

  let helper: string
  if (!badge.available) helper = CHAT_BADGE_COPY.needsTwitch
  else if (local?.own === 'off') helper = CHAT_BADGE_COPY.turnedOff
  else if (own === 'off') helper = outdated ? CHAT_BADGE_COPY.renew : CHAT_BADGE_COPY.off
  else if (badge.state === 'paused' && !local) helper = CHAT_BADGE_COPY.paused
  else if (badge.state === 'waiting' && !local) helper = CHAT_BADGE_COPY.waiting
  else helper = CHAT_BADGE_COPY.on(login)

  return (
    <PulseSectionCard title="In chat" headingLevel={3}>
      <div className="pulse-chat-badge" data-chat-badge-state={local?.own ?? (outdated ? 'renew' : badge.state)}>
        <div className="pulse-settings-toggle-row">
          <div>
            <label className="pulse-settings-label" htmlFor={switchId}>{CHAT_BADGE_COPY.switchLabel}</label>
            <span className="pulse-settings-hint" id={`${switchId}-hint`} role="status">{helper}</span>
            {own === 'on' && badge.state !== 'paused' && badge.available ? <span className="pulse-settings-hint">{CHAT_BADGE_COPY.onLatency}</span> : null}
          </div>
          <input
            id={switchId}
            type="checkbox"
            role="switch"
            className="pulse-settings-toggle"
            checked={own === 'on'}
            disabled={disabled}
            aria-describedby={`${switchId}-hint`}
            // Off → the consent panel; the switch flips only after the server says on.
            onChange={() => { if (own === 'on') void act('off'); else { setNotice(''); setConfirming(true) } }}
          />
        </div>
        {own === 'on' && badge.available ? <div className="pulse-account-link-actions pulse-journey-actions"><button type="button" disabled={busy} onClick={() => void act('off')}>{CHAT_BADGE_COPY.turnOff}</button></div> : null}
        {confirming && own === 'off' ? <div className="pulse-journey-confirm" role="group" aria-label={CHAT_BADGE_CONSENT_COPY.heading} data-chat-badge-consent={CHAT_BADGE_CONSENT_COPY.version}>
          <p><strong>{CHAT_BADGE_CONSENT_COPY.heading}</strong></p>
          <ul className="pulse-chat-badge-consent">{CHAT_BADGE_CONSENT_COPY.points.map(point => <li key={point}>{point}</li>)}</ul>
          <p>{CHAT_BADGE_CONSENT_COPY.confirmTwitch}</p>
          <div className="pulse-account-link-actions pulse-journey-actions">
            <button className="pulse-twitch-signin" type="button" disabled={busy} aria-busy={busy || undefined} onClick={() => void act('on')}><TwitchGlitch />{CHAT_BADGE_CONSENT_COPY.accept}</button>
            <button type="button" disabled={busy} onClick={() => { setConfirming(false); setNotice(CHAT_BADGE_COPY.nothingChanged) }}>{CHAT_BADGE_CONSENT_COPY.decline}</button>
          </div>
        </div> : null}
        {notice ? <p className="pulse-settings-hint" role="alert">{notice}</p> : null}
      </div>
    </PulseSectionCard>
  )
}
