import { useEffect, useRef, useState } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
import type { BackgroundResponse } from '../shared/messages.ts'
import { POLICY_LINKS } from '../shared/portalLinks.ts'
import { TwitchGlitch } from './TwitchAccountConnection.tsx'

export const LINKED_COPY = {
  heading: 'Linked to this membership',
  stripe: 'Stripe email',
  stripeValue: 'Restores it on a new browser.',
  twitch: 'Twitch',
  notLinked: 'Not linked. Needed for Seen in chat.',
  linkedNoLogin: 'Linked',
  link: 'Link Twitch',
  unlink: 'Unlink',
  panelHeading: 'Link Twitch to this membership?',
  panelPoints: [
    'Your membership, tenure and billing stay the same.',
    'Your Stripe email still restores it on a new browser.',
    'Linking shows nothing in chat. Seen in chat stays off until you turn it on.',
  ],
  confirmTwitch: 'You’ll confirm with Twitch that it’s your account.',
  continue: 'Continue with Twitch',
  opening: 'Opening Twitch…',
  notNow: 'Not now',
  linked: (login: string | undefined) => `Twitch linked${login ? ` as @${login}` : ''}. Your membership didn’t change.`,
  elsewhere: 'That Twitch account is already linked to another StreamPulse account. Nothing changed.',
  contactSupport: 'Contact support',
  failed: 'Couldn’t link right now. Nothing changed. Try again in a moment.',
  nothingChanged: 'Nothing changed.',
  unlinkHeading: 'Unlink Twitch?',
  unlinkBody: 'Seen in chat turns off first; other viewers may keep a cached copy until it refreshes or expires. Your membership stays.',
  unlinkConfirm: 'Unlink',
  cancel: 'Cancel',
  unlinked: 'Twitch unlinked. Your membership didn’t change.',
  unlinkFailed: 'Couldn’t unlink right now. Try again in a moment.',
} as const

type LinkReply = Extract<BackgroundResponse, { type: 'SUPPORTER_TWITCH_LINK' }>
type Notice = { text: string; kind: 'status' | 'alert' | 'elsewhere' } | null

/**
 * "Linked to this membership" on a pay-first membership card: the Stripe
 * email that restores it, and Twitch, which Seen in chat needs. Link Twitch
 * opens an inline panel (here, or from the Seen in chat card) that says the
 * membership stays the same; the server attaches Twitch to this account and
 * never creates one, and on a conflict it changes nothing. Unlink turns Seen
 * in chat off first.
 */
export function SupporterLinkedRows({ twitch, open, onOpen, onClose, onLinked, onUnlinked, disabled = false }: {
  twitch: { linked: boolean; login?: string }
  /** The link panel; the parent owns it so the Seen in chat card can open it too. */
  open: boolean
  onOpen: () => void
  /** `returnFocus`: Not now gives focus back to whichever button opened the panel. */
  onClose: (returnFocus: boolean) => void
  onLinked: (login: string | undefined) => void
  onUnlinked: () => void
  disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [focusTo, setFocusTo] = useState<'panel' | 'unlink-panel' | 'link' | 'unlink' | 'status' | null>(null)
  const panelHeading = useRef<HTMLParagraphElement>(null)
  const unlinkHeading = useRef<HTMLParagraphElement>(null)
  const linkButton = useRef<HTMLButtonElement>(null)
  const unlinkButton = useRef<HTMLButtonElement>(null)
  const statusLine = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (open) { setNotice(null); setFocusTo('panel') } }, [open])
  useEffect(() => {
    if (!focusTo) return
    const target = { 'panel': panelHeading, 'unlink-panel': unlinkHeading, 'link': linkButton, 'unlink': unlinkButton, 'status': statusLine }[focusTo].current
    if (focusTo === 'panel') target?.scrollIntoView?.({ block: 'nearest' })
    target?.focus()
    setFocusTo(null)
  }, [focusTo])

  async function send(action: 'link' | 'unlink'): Promise<LinkReply | null> {
    setBusy(true)
    setNotice(null)
    try {
      const reply = await sendBackgroundMessage({ type: 'SUPPORTER_TWITCH_LINK', action }) as LinkReply | undefined
      return reply?.type === 'SUPPORTER_TWITCH_LINK' ? reply : null
    } catch { return null } finally { setBusy(false) }
  }
  async function link() {
    const reply = await send('link')
    if (reply?.ok) {
      onLinked(reply.login)
      onClose(false)
      setNotice({ text: LINKED_COPY.linked(reply.login), kind: 'status' })
      setFocusTo('status')
      return
    }
    // Focus goes back to whichever button opened the panel; the alert says what happened.
    onClose(true)
    setNotice(reply?.error === 'linked_elsewhere' ? { text: LINKED_COPY.elsewhere, kind: 'elsewhere' }
      : reply?.error === 'cancelled' ? { text: LINKED_COPY.nothingChanged, kind: 'alert' }
      : { text: LINKED_COPY.failed, kind: 'alert' })
  }
  async function unlink() {
    const reply = await send('unlink')
    setConfirmUnlink(false)
    if (reply?.ok) {
      onUnlinked()
      setNotice({ text: LINKED_COPY.unlinked, kind: 'status' })
      setFocusTo('status')
    } else {
      setNotice({ text: LINKED_COPY.unlinkFailed, kind: 'alert' })
      setFocusTo('unlink')
    }
  }

  return (
    <div className="pulse-supporter-linked" data-supporter-linked>
      <div className="pulse-supporter-linked-body">
        <p className="pulse-supporter-linked-heading">{LINKED_COPY.heading}</p>
        <dl className="pulse-supporter-rows">
          <div data-row="stripe-email">
            <dt>{LINKED_COPY.stripe}</dt>
            <dd>{LINKED_COPY.stripeValue}</dd>
            <dd />
          </div>
          <div data-row="twitch">
            <dt>{LINKED_COPY.twitch}</dt>
            <dd>{twitch.linked ? twitch.login ? `@${twitch.login}` : LINKED_COPY.linkedNoLogin : LINKED_COPY.notLinked}</dd>
            <dd className="pulse-account-link-actions">
              {twitch.linked
                ? <button ref={unlinkButton} type="button" disabled={disabled || busy} aria-expanded={confirmUnlink} onClick={() => { setNotice(null); setConfirmUnlink(true); setFocusTo('unlink-panel') }}>{LINKED_COPY.unlink}</button>
                : <button ref={linkButton} type="button" disabled={disabled || busy} aria-expanded={open} onClick={onOpen}>{LINKED_COPY.link}</button>}
            </dd>
          </div>
        </dl>
        {open && !twitch.linked ? <div className="pulse-journey-confirm" role="group" aria-label={LINKED_COPY.panelHeading} data-twitch-link-panel>
          <p tabIndex={-1} ref={panelHeading}><strong>{LINKED_COPY.panelHeading}</strong></p>
          <ul className="pulse-chat-badge-consent">{LINKED_COPY.panelPoints.map(point => <li key={point}>{point}</li>)}</ul>
          <p>{LINKED_COPY.confirmTwitch}</p>
          <div className="pulse-account-link-actions pulse-journey-actions">
            <button className="pulse-twitch-signin" type="button" disabled={disabled || busy} aria-busy={busy || undefined} onClick={() => void link()}><TwitchGlitch />{busy ? LINKED_COPY.opening : LINKED_COPY.continue}</button>
            <button type="button" disabled={busy} onClick={() => { setNotice({ text: LINKED_COPY.nothingChanged, kind: 'status' }); onClose(true) }}>{LINKED_COPY.notNow}</button>
          </div>
        </div> : null}
        {confirmUnlink && twitch.linked ? <div className="pulse-journey-confirm" role="group" aria-label={LINKED_COPY.unlinkHeading} data-twitch-unlink-panel>
          <p tabIndex={-1} ref={unlinkHeading}><strong>{LINKED_COPY.unlinkHeading}</strong></p>
          <p>{LINKED_COPY.unlinkBody}</p>
          <div className="pulse-account-link-actions pulse-journey-actions">
            <button type="button" disabled={disabled || busy} aria-busy={busy || undefined} onClick={() => void unlink()}>{LINKED_COPY.unlinkConfirm}</button>
            <button type="button" disabled={busy} onClick={() => { setConfirmUnlink(false); setFocusTo('unlink') }}>{LINKED_COPY.cancel}</button>
          </div>
        </div> : null}
      </div>
      {/* Always present, so the outcome is announced when it arrives. */}
      <div role="status" aria-live="polite" className="pulse-supporter-account-status" data-twitch-link-notice>
        {notice?.kind === 'status' ? <p className="pulse-journey-notice" tabIndex={-1} ref={statusLine}>{notice.text}</p> : null}
      </div>
      {/* Failures use role=alert, as the Seen in chat card does. */}
      <div className="pulse-supporter-account-status">
        {notice && notice.kind !== 'status' ? <p className="pulse-journey-notice" role="alert" data-twitch-link-alert>
          {notice.text}
          {notice.kind === 'elsewhere' ? <> <a href={POLICY_LINKS.support} target="_blank" rel="noopener noreferrer">{LINKED_COPY.contactSupport}</a></> : null}
        </p> : null}
      </div>
    </div>
  )
}
