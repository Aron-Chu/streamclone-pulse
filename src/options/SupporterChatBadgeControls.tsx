import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
import { CHAT_BADGE_CONSENT_VERSION, type ChatBadgeActionError } from '../shared/chatBadges.ts'
import type { SupporterEntitlement } from '../shared/supporterAccount.ts'
import { SUPPORTER_TENURES, type SupporterPaintStyle, type SupporterTenure } from '../shared/supporterPaint.ts'
import { finishVars } from '../supporter/kit.ts'
import { PulseSectionCard } from '../ui/PulseSectionCard.tsx'
import type { SupporterFinishId } from '../ui/supporterFinish.ts'
import { SupporterCardTag } from './SupporterCardTag.tsx'
import { TwitchGlitch } from './TwitchAccountConnection.tsx'
import { useChatBadgeListReceived, type ChatBadgeReply } from './useChatBadges.ts'

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
    'Twitch chat itself doesn’t change. People without StreamPulse see normal chat. StreamPulse checks Twitch for current usernames so that renames can be reflected.',
    'To display these cosmetics, each extension downloads the whole list without identifying which chat it is displaying. Other StreamPulse features may send channel information as described in the privacy notice.',
    'You can turn this off any time. Your entry is removed from future published lists; other viewers may continue to see a cached copy until it refreshes or expires.',
  ],
  confirmTwitch: 'You’ll confirm with Twitch that it’s your account.',
  accept: 'Continue with Twitch and turn on',
  decline: 'Not now',
  version: CHAT_BADGE_CONSENT_VERSION,
} as const

export const CHAT_BADGE_COPY = {
  title: 'Seen in chat',
  lead: 'Show my crest and paint to other StreamPulse viewers in chat',
  off: 'Off. Only you see your crest and paint.',
  turnedOff: 'Off. Your entry will leave future lists; cached copies may take time to refresh.',
  on: (login: string | undefined) => `On. Other StreamPulse viewers see your crest and paint next to ${login ? `@${login}` : 'your name'} in chat.`,
  onLatency: 'Changes reach other viewers as their lists refresh.',
  waiting: 'On. Waiting for Twitch to confirm your username — your crest appears in chat once it does.',
  paused: 'Paused while your membership is inactive. If you support again within 30 days it comes back on its own; after that, turn it on again.',
  needsTwitch: 'Seen in chat needs Continue with Twitch.',
  linkFirst: 'Link Twitch to this membership first. Nothing shows in chat until you turn it on.',
  renew: 'Turn on again to keep showing: what Seen in chat shares has been updated.',
  unknown: 'Can’t check right now.',
  lastKnownOn: 'Last known: on — other StreamPulse viewers may still see your crest.',
  review: 'Review and turn on',
  turnOff: 'Turn off',
  linkTwitch: 'Link Twitch',
  checkAgain: 'Check again',
  checking: 'Checking…',
  wouldSee: 'StreamPulse viewers would see',
  see: 'StreamPulse viewers see',
  everyoneElse: 'Everyone else sees',
  message: 'hello chat',
  nothingChanged: 'Nothing changed.',
} as const

/** The card's tag after "Public · ": never On before the server says so. */
export const CHAT_BADGE_TAGS = { off: 'Off', pending: 'Pending', on: 'On', paused: 'Paused', renew: 'Needs your OK', unknown: 'Unknown' } as const

export const CHAT_BADGE_ERRORS: Partial<Record<ChatBadgeActionError, string>> = {
  identity_mismatch: 'That Twitch account isn’t the one signed in here. Use the same Twitch account.',
  supporter_required: 'Seen in chat is for active Supporters.',
  cancelled: CHAT_BADGE_COPY.nothingChanged,
}
const FALLBACK_ERROR = 'Couldn’t turn it on right now. Nothing changed. Try again in a moment.'
const OFF_ERROR = 'Couldn’t turn it off right now. Try again in a moment.'

/**
 * The last state the server reported, kept in this browser so a failed check
 * can say "Last known: on" instead of guessing. It holds on or off, nothing else.
 */
const LAST_KNOWN_KEY = 'pulseSeenInChatLastKnown'
function readLastKnown(): 'on' | 'off' | null {
  try {
    const value = localStorage.getItem(LAST_KNOWN_KEY)
    return value === 'on' || value === 'off' ? value : null
  } catch { return null }
}
function writeLastKnown(value: 'on' | 'off' | null): void {
  try {
    if (value) localStorage.setItem(LAST_KNOWN_KEY, value)
    else localStorage.removeItem(LAST_KNOWN_KEY)
  } catch { /* Storage may be refused; the card still works without it. */ }
}

/** The look your chat line wears: the equipped paint, your wave, your crest. */
export interface SeenInChatLook {
  finish: SupporterFinishId | null
  paint: SupporterPaintStyle
  tenure: SupporterTenure
}

/** What the membership card offers this card. */
export interface SeenInChatLink {
  /** Opens Link Twitch on the membership card; null where this browser can't link. */
  open: (() => void) | null
  /** The login Link Twitch just returned, before the server's next read names it. */
  login?: string
  /** Linked or unlinked here, before the server's next read says so; undefined where the membership card has no Twitch row. */
  linked?: boolean
  checkAgain?: () => Promise<void> | void
}

type Local = { own: 'on' | 'off'; login?: string } | null
type Phase = 'link' | 'needs-twitch' | 'off' | 'turned-off' | 'renew' | 'pending' | 'paused' | 'on'

const PHASE_TAG: Record<Phase, keyof typeof CHAT_BADGE_TAGS> = {
  'link': 'off', 'needs-twitch': 'off', 'off': 'off', 'turned-off': 'off', 'renew': 'renew', 'pending': 'pending', 'paused': 'paused', 'on': 'on',
}

function PublicTag({ state }: { state: keyof typeof CHAT_BADGE_TAGS }) {
  return <SupporterCardTag audience="public" tone={state === 'on' ? 'on' : state === 'pending' ? 'pending' : state === 'unknown' ? 'unknown' : undefined}>{`Public · ${CHAT_BADGE_TAGS[state]}`}</SupporterCardTag>
}

/**
 * The two chat lines this card is about: what StreamPulse viewers would see,
 * drawn with the overlay's own paint and crest styles, and the normal line
 * everyone else sees. Chat draws paint and wave but no sheen.
 */
function ChatPreview({ look, login, live }: { look: SeenInChatLook; login: string | undefined; live: boolean }) {
  const name = login ?? 'you'
  const tenure = SUPPORTER_TENURES.find(option => option.id === look.tenure)
  return (
    <dl className="pulse-chat-badge-preview" style={finishVars(look.finish) as CSSProperties} data-chat-badge-preview>
      <dt>{live ? CHAT_BADGE_COPY.see : CHAT_BADGE_COPY.wouldSee}</dt>
      <dd className="pulse-supporter-chat-line">
        <i className="pulse-crest" data-tenure={look.tenure} role="img" aria-label={`StreamPulse Supporter, ${!tenure || tenure.id === 'new' ? 'new' : tenure.label}`} />
        {look.finish
          ? <b className="pulse-paint" data-finish={look.finish} data-wave={look.paint.wave} data-sheen="none" data-text={name}>{name}</b>
          : <b className="pulse-chat-badge-plain-name">{name}</b>}
        : {CHAT_BADGE_COPY.message}
      </dd>
      <dt>{CHAT_BADGE_COPY.everyoneElse}</dt>
      <dd className="pulse-supporter-chat-line"><b className="pulse-chat-badge-plain-name">{name}</b>: {CHAT_BADGE_COPY.message}</dd>
    </dl>
  )
}

/**
 * Seen in chat: the one public Supporter card, below Your look. Shown only
 * when the server reports the feature (`chatBadge` in the Supporter snapshot),
 * this build pins a list key, and you are, or were recently, a Supporter.
 * A button per state, never a switch: turning on opens the consent with the
 * preview kept above it and needs a fresh Twitch check; turning off is one
 * click. The tag says On only once the server does. Nothing here grants
 * anything: the server decides what is published.
 */
export function SupporterChatBadgeControls({ entitlement, unavailable = false, look, link }: {
  entitlement: SupporterEntitlement | null
  /** With `entitlement` null: the status could not be read, rather than still loading. */
  unavailable?: boolean
  look: SeenInChatLook
  link?: SeenInChatLink
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [notice, setNotice] = useState('')
  const [local, setLocal] = useState<Local>(null)
  const [focusTo, setFocusTo] = useState<'consent' | 'review' | 'status' | null>(null)
  const [lastKnown] = useState(readLastKnown)
  const consentHeading = useRef<HTMLParagraphElement>(null)
  const reviewButton = useRef<HTMLButtonElement>(null)
  const statusLine = useRef<HTMLParagraphElement>(null)
  const [, , keysPinned] = useChatBadgeListReceived()
  const ready = entitlement?.state === 'ready' ? entitlement : null
  const badge = ready?.chatBadge
  const serverKey = badge ? `${badge.state}:${badge.login ?? ''}:${badge.available}` : ''
  // A fresh server read replaces what this card assumed after its own action.
  useEffect(() => { setLocal(null) }, [serverKey])
  useEffect(() => {
    if (!focusTo) return
    const target = focusTo === 'consent' ? consentHeading.current : focusTo === 'review' ? reviewButton.current : statusLine.current
    target?.focus()
    setFocusTo(null)
  }, [focusTo])
  const supporter = ready?.status === 'active' || ready?.status === 'grace'
  // A build that pins no list key would publish your Twitch ID for a crest no
  // one using it can see: offer turning on only where lists can be verified.
  // An entry that is already on still shows, so it can be turned off.
  const visible = !badge ? null : (supporter || badge.state !== 'off') && (keysPinned || badge.state !== 'off' || local?.own === 'on')
  const serverOn = badge?.state === 'on' || badge?.state === 'waiting'
  useEffect(() => {
    if (visible !== null) writeLastKnown(visible ? serverOn ? 'on' : 'off' : null)
  }, [visible, serverOn])

  if (!badge) {
    // A failed read is not Off: say so, with the last state this browser saw.
    if (!unavailable || !lastKnown) return null
    return (
      <PulseSectionCard title={CHAT_BADGE_COPY.title} headingLevel={3} className="pulse-chat-badge-card" titleAction={<PublicTag state="unknown" />}>
        <div className="pulse-chat-badge" data-chat-badge-state="unknown">
          <p className="pulse-settings-hint" role="status">{CHAT_BADGE_COPY.unknown}{lastKnown === 'on' ? ` ${CHAT_BADGE_COPY.lastKnownOn}` : ''}</p>
          {link?.checkAgain ? <div className="pulse-account-link-actions pulse-journey-actions">
            <button type="button" disabled={checking} aria-busy={checking || undefined} onClick={() => {
              setChecking(true)
              void Promise.resolve(link.checkAgain?.()).finally(() => setChecking(false))
            }}>{checking ? CHAT_BADGE_COPY.checking : CHAT_BADGE_COPY.checkAgain}</button>
          </div> : null}
        </div>
      </PulseSectionCard>
    )
  }
  if (!visible) return null

  // The server marks an outdated consent as paused, not on. It still holds a
  // row that the supporter must be able to renew or explicitly withdraw.
  const outdated = badge.state !== 'off' && badge.consentVersion !== undefined && badge.consentVersion < CHAT_BADGE_CONSENT_VERSION
  const login = local?.login ?? badge.login ?? link?.login
  let phase: Phase
  if (!(link?.linked ?? badge.available)) phase = link?.open ? 'link' : 'needs-twitch'
  else if (local?.own === 'off') phase = 'turned-off'
  // Accepted, but On only once the server's next read says so.
  else if (local?.own === 'on') phase = 'pending'
  else if (outdated) phase = 'renew'
  else if (badge.state === 'off') phase = 'off'
  else if (badge.state === 'paused') phase = 'paused'
  else if (badge.state === 'waiting') phase = 'pending'
  else phase = 'on'

  async function act(action: 'on' | 'off') {
    setBusy(true)
    setNotice('')
    try {
      const reply = await sendBackgroundMessage({ type: 'SUPPORTER_CHAT_BADGE', action }) as ChatBadgeReply | undefined
      if (reply?.type === 'SUPPORTER_CHAT_BADGE' && reply.ok) {
        setLocal({ own: action, ...(reply.login ? { login: reply.login } : {}) })
        setConfirming(false)
        setFocusTo('status')
      } else {
        const error = reply?.type === 'SUPPORTER_CHAT_BADGE' ? reply.error : undefined
        setNotice(action === 'off' ? OFF_ERROR : (error && CHAT_BADGE_ERRORS[error]) || FALLBACK_ERROR)
        if (error === 'cancelled') { setConfirming(false); setFocusTo('review') }
      }
    } catch {
      setNotice(action === 'off' ? OFF_ERROR : FALLBACK_ERROR)
    } finally {
      setBusy(false)
    }
  }

  const status = {
    'link': CHAT_BADGE_COPY.linkFirst,
    'needs-twitch': CHAT_BADGE_COPY.needsTwitch,
    'off': CHAT_BADGE_COPY.off,
    'turned-off': CHAT_BADGE_COPY.turnedOff,
    'renew': CHAT_BADGE_COPY.renew,
    'pending': CHAT_BADGE_COPY.waiting,
    'paused': CHAT_BADGE_COPY.paused,
    'on': CHAT_BADGE_COPY.on(login),
  }[phase]
  const canReview = phase === 'off' || phase === 'turned-off' || phase === 'renew'
  const canTurnOff = phase === 'renew' || phase === 'pending' || phase === 'paused' || phase === 'on'
  const reviewShown = canReview && !confirming

  return (
    <PulseSectionCard title={CHAT_BADGE_COPY.title} headingLevel={3} className="pulse-chat-badge-card" titleAction={<PublicTag state={PHASE_TAG[phase]} />}>
      <div className="pulse-chat-badge" data-chat-badge-state={phase}>
        <p className="pulse-supporter-detail">{CHAT_BADGE_COPY.lead}</p>
        <ChatPreview look={look} login={login} live={phase === 'on'} />
        <div>
          <p className="pulse-settings-hint" role="status" tabIndex={-1} ref={statusLine}>{status}</p>
          {phase === 'on' ? <p className="pulse-settings-hint">{CHAT_BADGE_COPY.onLatency}</p> : null}
        </div>
        {confirming && canReview ? <div className="pulse-journey-confirm" role="group" aria-label={CHAT_BADGE_CONSENT_COPY.heading} data-chat-badge-consent={CHAT_BADGE_CONSENT_COPY.version}>
          <p tabIndex={-1} ref={consentHeading}><strong>{CHAT_BADGE_CONSENT_COPY.heading}</strong></p>
          <ul className="pulse-chat-badge-consent">{CHAT_BADGE_CONSENT_COPY.points.map(point => <li key={point}>{point}</li>)}</ul>
          <p>{CHAT_BADGE_CONSENT_COPY.confirmTwitch}</p>
          <div className="pulse-account-link-actions pulse-journey-actions">
            <button className="pulse-twitch-signin" type="button" disabled={busy} aria-busy={busy || undefined} onClick={() => void act('on')}><TwitchGlitch />{CHAT_BADGE_CONSENT_COPY.accept}</button>
            <button type="button" disabled={busy} onClick={() => { setConfirming(false); setNotice(CHAT_BADGE_COPY.nothingChanged); setFocusTo('review') }}>{CHAT_BADGE_CONSENT_COPY.decline}</button>
          </div>
        </div> : null}
        {phase === 'link' || reviewShown || canTurnOff ? <div className="pulse-account-link-actions pulse-journey-actions">
          {phase === 'link' ? <button type="button" onClick={() => link?.open?.()}>{CHAT_BADGE_COPY.linkTwitch}</button> : null}
          {reviewShown ? <button ref={reviewButton} className="pulse-journey-primary" type="button" disabled={busy || !keysPinned} onClick={() => { setNotice(''); setConfirming(true); setFocusTo('consent') }}>{CHAT_BADGE_COPY.review}</button> : null}
          {canTurnOff ? <button type="button" disabled={busy} aria-busy={busy && !confirming || undefined} onClick={() => void act('off')}>{CHAT_BADGE_COPY.turnOff}</button> : null}
        </div> : null}
        {notice ? <p className="pulse-settings-hint" role="alert">{notice}</p> : null}
      </div>
    </PulseSectionCard>
  )
}
