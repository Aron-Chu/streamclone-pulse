import { useId, type CSSProperties, type ReactNode } from 'react'
import type { SupporterStatus } from '../shared/supporterAccount.ts'
import type { SupporterPaintStyle, SupporterTenure } from '../shared/supporterPaint.ts'
import { DEFAULT_PULSE_BANNER, type PulseBannerPreference } from '../shared/storage.ts'
import { TENURES, finishVars, tenureIndex } from '../supporter/kit.ts'
import { PeakMark } from '../ui/PeakMark.tsx'
import { PulseBannerBackdrop } from '../ui/PulseBanner.tsx'
import type { SupporterFinishId } from '../ui/supporterFinish.ts'

/**
 * Who the card is about. It shows only an identity that really exists: today
 * that is the StreamPulse account this extension is connected to (masked the
 * way streampulse.stream shows it), or nobody. While the account state is still
 * loading or could not be read, the card is `unknown`: it claims neither an
 * account nor its absence. With Continue with Twitch compiled on
 * (`TWITCH_SIGNIN_STAGE` tester or public), the `twitch` kind carries the
 * display-only profile that sign-in returns for this browser session; it is
 * never stored by StreamPulse. After a browser restart that profile is gone
 * and the kind stays `twitch` with no name.
 */
export type CardIdentity =
  | { kind: 'none'; connection?: 'installation' }
  | { kind: 'unknown'; reason: 'checking' | 'unavailable' }
  | { kind: 'pulse'; reference?: string }
  | { kind: 'twitch'; displayName?: string; picture?: string }

/**
 * What the card can say about membership: the server's status, or `checking`
 * before it arrives and `unknown` when it could not be read. Those two claim
 * neither membership nor its absence.
 */
export type CardStatus = SupporterStatus | 'checking' | 'unknown'

/** The membership the card states. */
export interface CardMembership {
  status: CardStatus
  months: number
  tenure: SupporterTenure
}

/** How the card is painted: a Supporter's look, or the sample everyone else sees. */
export interface CardLook {
  finish: SupporterFinishId | null
  paint: SupporterPaintStyle
  /** Supporter perks are on: the name wears the paint and crest, and the sample tag goes. */
  perks: boolean
}

/** The ladder's five crests, with the month each one arrives. */
const LADDER: ReadonlyArray<{ id: SupporterTenure; label: string; months: number }> = [
  { id: 'new', label: 'New', months: 0 },
  { id: '3m', label: '3 mo', months: 3 },
  { id: '6m', label: '6 mo', months: 6 },
  { id: '12m', label: '1 year', months: 12 },
  { id: '24m', label: '2 years', months: 24 },
]

/** The card's own emote rain: decoration, the same falling 7TV set the Pulse panel draws. */
const CARD_RAIN: PulseBannerPreference = { ...DEFAULT_PULSE_BANNER, mode: 'rain', intensity: 50 }

const months = (count: number) => `${count} ${count === 1 ? 'month' : 'months'}`

/** The card's line for a membership that is not active or in grace, after the account. */
const STATUS_LINE: Record<Exclude<CardStatus, 'active' | 'grace'>, string> = {
  checking: 'checking membership…',
  unknown: 'membership status unavailable',
  none: 'not a Supporter yet',
  pending: 'payment confirming',
  review: 'membership needs review',
  expired: 'Supporter ended',
}

const isSupporter = (status: CardStatus) => status === 'active' || status === 'grace'
const isKnown = (status: CardStatus) => status !== 'checking' && status !== 'unknown'

/**
 * The Account & Supporter page's lead, direction B "Your card" of the
 * 2026-10-07 redesign: a Twitch-style viewer card with emote rain across its
 * top, the avatar, the name (painted, with the crest, for a Supporter), the
 * membership in one line and the action for the current account state.
 * The five-step crest ladder and cosmetic studio share a preview disclosure,
 * collapsed for nonmembers. The membership journey (`children`) stays visible:
 * the price and one button, or the renewal date and billing.
 *
 * The card is a section headed by a visually hidden h3, so heading navigation
 * stops here between the page's h2 and "Your look"; the card's own lines
 * (the name, the membership, the footer's title) stay as drawn.
 */
export function SupporterCard({ identity, membership, look, children, preview }: {
  identity: CardIdentity
  membership: CardMembership
  look: CardLook
  children: ReactNode
  preview?: ReactNode
}) {
  const { status } = membership
  const known = isKnown(status)
  const own = isSupporter(status) && look.perks
  // A crest earned before a review is held, not lost.
  const current = isSupporter(status) || (status === 'review' && membership.months > 0) ? tenureIndex(membership.tenure) : -1
  const name = cardName(identity)
  // Only a real identity wears the paint and crest; a status line never does.
  const painted = own && look.finish && (identity.kind === 'pulse' || identity.kind === 'twitch')
  const headingId = useId()
  return (
    <section className="pulse-supporter-card" aria-labelledby={headingId} data-supporter-card={own ? 'own' : 'sample'} style={finishVars(look.finish) as CSSProperties}>
      <h3 id={headingId} className="pulse-visually-hidden">Your Supporter card</h3>
      <div className="pulse-supporter-card-banner pulse-personal-panel">
        <PulseBannerBackdrop value={CARD_RAIN} perks />
        {/* Only a known non-Supporter is told the look is a sample. */}
        {isSupporter(status) || !known ? null : <span className="pulse-supporter-card-sample">Sample look</span>}
      </div>
      <div className="pulse-supporter-card-body">
        <CardAvatar identity={identity} />
        <div className="pulse-supporter-card-who">
          <strong data-identity={identity.kind}>
            {painted ? <i className="pulse-crest" data-tenure={membership.tenure} aria-hidden="true" /> : null}
            {painted
              ? <span className="pulse-paint" data-finish={look.finish ?? undefined} data-wave={look.paint.wave} data-sheen={look.paint.sheen} data-text={name}>{name}</span>
              : name}
          </strong>
          <span>{subline(identity, membership)}</span>
        </div>
      </div>
      {children}
      <details className="pulse-supporter-preview-disclosure" data-supporter-preview-disclosure open={isSupporter(status) || undefined}>
        <summary>Preview Supporter looks</summary>
        <div className="pulse-supporter-preview-content">
          <div className="pulse-supporter-card-ladder">
            <ol className="pulse-supporter-ladder" aria-label="Crest ladder" style={{ '--fill': current > 0 ? current / (LADDER.length - 1) : 0 } as CSSProperties}>
              {LADDER.map((step, index) => (
                <li key={step.id} data-tier={step.id} data-step={current < 0 ? (known && index === 0 ? 'start' : 'off') : index < current ? 'past' : index === current ? 'current' : 'off'} aria-current={index === current ? 'step' : undefined}>
                  <span><i className="pulse-crest" data-tenure={step.id} aria-hidden="true" /></span>
                  <small>{step.label}</small>
                </li>
              ))}
            </ol>
            <p className="pulse-supporter-ladder-next">{nextLine(membership, current)}</p>
          </div>
          {preview}
        </div>
      </details>
    </section>
  )
}

function cardName(identity: CardIdentity): string {
  switch (identity.kind) {
    case 'none': return identity.connection === 'installation' ? 'Not connected' : 'Not signed in'
    case 'unknown': return identity.reason === 'checking' ? 'Checking your account…' : 'Account unavailable'
    case 'twitch': return identity.displayName ?? 'You'
    // A StreamPulse account has no public name; its reference stays in Account, not on the card.
    default: return 'You'
  }
}

function subline(identity: CardIdentity, membership: CardMembership): string {
  const { status } = membership
  if (identity.kind === 'none') return 'Free tools work without an account.'
  if (status === 'active' || status === 'grace') return [membership.months > 0 ? `Supporter for ${months(membership.months)}` : 'Pulse Supporter', status === 'grace' ? 'payment due' : null].filter(Boolean).join(' · ')
  const line = STATUS_LINE[status]
  if (identity.kind === 'unknown') return isKnown(status) ? line.charAt(0).toUpperCase() + line.slice(1) : 'Your free tools still work.'
  const who = identity.kind === 'twitch' ? 'Signed in with Twitch' : 'StreamPulse account'
  return `${who} · ${line}`
}

function nextLine(membership: CardMembership, current: number): ReactNode {
  if (!isKnown(membership.status)) return <>A crest starts at <b>New</b> and grows at 3, 6, 12 and 24 months.</>
  if (current < 0) return <>Your crest starts at <b>New</b> and grows at 3, 6, 12 and 24 months.</>
  if (membership.status === 'review') return <><b>{TENURES[current].title}</b> earned · on hold while your membership is reviewed</>
  const now = <><b>{TENURES[current].title}</b> now</>
  const next = LADDER[current + 1]
  if (!next) return <>{now} · the top crest</>
  return <>{now} · <b>{TENURES[current + 1].title}</b> in {months(Math.max(1, next.months - membership.months))}</>
}

/** The avatar: a neutral silhouette for nobody or an account not known yet, the StreamPulse mark for an account with no name to show. */
function CardAvatar({ identity }: { identity: CardIdentity }) {
  return (
    <span className="pulse-supporter-card-avatar" data-identity={identity.kind} aria-hidden="true">
      {identity.kind === 'none' || identity.kind === 'unknown'
        ? <svg width="28" height="28" viewBox="0 0 24 24"><circle cx="12" cy="9" r="4" fill="currentColor" /><path d="M4.5 20c0-4.1 3.4-6.5 7.5-6.5s7.5 2.4 7.5 6.5z" fill="currentColor" /></svg>
        : identity.kind === 'pulse' || !identity.displayName
          ? <PeakMark size={30} strokeWidth={1.8} stroke="currentColor" />
          : identity.picture
            ? <img src={identity.picture} alt="" referrerPolicy="no-referrer" />
            : identity.displayName.charAt(0).toUpperCase()}
    </span>
  )
}
