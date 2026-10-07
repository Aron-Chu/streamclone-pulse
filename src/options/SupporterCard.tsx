import type { CSSProperties, ReactNode } from 'react'
import type { SupporterPaintStyle, SupporterTenure } from '../shared/supporterPaint.ts'
import { DEFAULT_PULSE_BANNER, type PulseBannerPreference } from '../shared/storage.ts'
import { TENURES, finishVars, tenureIndex } from '../supporter/kit.ts'
import { PeakMark } from '../ui/PeakMark.tsx'
import { PulseBannerBackdrop } from '../ui/PulseBanner.tsx'
import type { SupporterFinishId } from '../ui/supporterFinish.ts'

/**
 * Who the card is about. It shows only an identity that really exists: today
 * that is the StreamPulse account this extension is connected to (masked the
 * way streampulse.stream shows it), or nobody. Sign in with Twitch is compiled
 * off in this build (`TWITCH_SIGNIN_ENABLED`), so there is no Twitch name or
 * picture to show. The `twitch` kind is the seam for when it ships: feed it the
 * display-only profile the sign-in returns.
 */
export type CardIdentity =
  | { kind: 'none' }
  | { kind: 'pulse'; reference?: string }
  | { kind: 'twitch'; displayName: string; picture?: string }

/** The membership the card states. `supporter` means active or grace. */
export interface CardMembership {
  supporter: boolean
  grace: boolean
  ended: boolean
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

/**
 * The Account & Supporter page's lead, direction B "Your card" of the
 * 2026-10-07 redesign: a Twitch-style viewer card with emote rain across its
 * top, the avatar, the name (painted, with the crest, for a Supporter), the
 * membership in one line, and a five-step crest ladder from New to 2 years.
 * The membership journey (`children`) is its footer: the price and one button,
 * or the renew date and billing.
 */
export function SupporterCard({ identity, membership, look, children }: {
  identity: CardIdentity
  membership: CardMembership
  look: CardLook
  children: ReactNode
}) {
  const own = membership.supporter && look.perks
  const current = membership.supporter ? tenureIndex(membership.tenure) : -1
  const name = identity.kind === 'none' ? 'Not signed in' : identity.kind === 'twitch' ? identity.displayName : identity.reference ?? 'StreamPulse account'
  const painted = own && look.finish
  return (
    <section className="pulse-supporter-card" aria-label="Your Supporter card" data-supporter-card={own ? 'own' : 'sample'} style={finishVars(look.finish) as CSSProperties}>
      <div className="pulse-supporter-card-banner pulse-personal-panel">
        <PulseBannerBackdrop value={CARD_RAIN} perks />
        {own ? null : <span className="pulse-supporter-card-sample">Sample look</span>}
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
      <div className="pulse-supporter-card-ladder">
        <ol className="pulse-supporter-ladder" aria-label="Crest ladder" style={{ '--fill': current > 0 ? current / (LADDER.length - 1) : 0 } as CSSProperties}>
          {LADDER.map((step, index) => (
            <li key={step.id} data-tier={step.id} data-step={current < 0 ? (index === 0 ? 'start' : 'off') : index < current ? 'past' : index === current ? 'current' : 'off'} aria-current={index === current ? 'step' : undefined}>
              <span><i className="pulse-crest" data-tenure={step.id} aria-hidden="true" /></span>
              <small>{step.label}</small>
            </li>
          ))}
        </ol>
        <p className="pulse-supporter-ladder-next">{nextLine(membership, current)}</p>
      </div>
      {children}
    </section>
  )
}

function subline(identity: CardIdentity, membership: CardMembership): string {
  if (identity.kind === 'none') return 'Free tools work without an account.'
  if (membership.supporter) return ['Pulse Supporter', membership.months > 0 ? months(membership.months) : null, membership.grace ? 'payment due' : null].filter(Boolean).join(' · ')
  const who = identity.kind === 'twitch' ? 'Signed in with Twitch' : 'StreamPulse account'
  return `${who} · ${membership.ended ? 'Supporter ended' : 'not a Supporter yet'}`
}

function nextLine(membership: CardMembership, current: number): ReactNode {
  if (current < 0) return <>Your crest starts at <b>New</b> and grows at 3, 6, 12 and 24 months.</>
  const now = <><b>{TENURES[current].title}</b> now</>
  const next = LADDER[current + 1]
  if (!next) return <>{now} · the top crest</>
  return <>{now} · <b>{TENURES[current + 1].title}</b> in {months(Math.max(1, next.months - membership.months))}</>
}

/** The avatar: a neutral silhouette for nobody, the StreamPulse mark for a StreamPulse account. */
function CardAvatar({ identity }: { identity: CardIdentity }) {
  return (
    <span className="pulse-supporter-card-avatar" data-identity={identity.kind} aria-hidden="true">
      {identity.kind === 'none'
        ? <svg width="28" height="28" viewBox="0 0 24 24"><circle cx="12" cy="9" r="4" fill="currentColor" /><path d="M4.5 20c0-4.1 3.4-6.5 7.5-6.5s7.5 2.4 7.5 6.5z" fill="currentColor" /></svg>
        : identity.kind === 'pulse'
          ? <PeakMark size={30} strokeWidth={1.8} stroke="currentColor" />
          : identity.picture
            ? <img src={identity.picture} alt="" referrerPolicy="no-referrer" />
            : identity.displayName.charAt(0).toUpperCase()}
    </span>
  )
}
