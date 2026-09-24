import { useCallback, useEffect, useRef, useState } from 'react'
import type { BackgroundResponse } from '../shared/messages.ts'
import { POLICY_LINKS, productLink } from '../shared/portalLinks.ts'
import type { SupporterEntitlement } from '../shared/supporterAccount.ts'
import { PulseSectionCard } from '../ui/PulseSectionCard.tsx'
import { usePortalOrigin } from './usePortalOrigin.ts'

/**
 * Supporter status and the one honest monthly offer.
 *
 * Purchase happens on streampulse.stream, not here: the extension worker sends
 * `credentials: 'omit'` and a bearer credential, so it cannot hold the browser
 * session that Checkout creation requires. This surface reads entitlement and
 * links out; it never asserts an entitlement locally.
 *
 * Existing members use the authenticated website billing page.
 */
const PRICE_DISPLAY = '$4.99 / month'

const STATUS_COPY: Record<string, { title: string; detail: string }> = {
  none: {
    // The card already closes with the free-tools statement, so this must not
    // repeat it.
    title: 'Not a Supporter yet',
    detail: 'Supporter funds development and adds a few original Pulse cosmetics.',
  },
  active: {
    title: 'Supporter active',
    detail: 'Thank you for supporting Pulse. Manage renewal and payment details on the website.',
  },
  grace: {
    title: 'Payment needs attention',
    detail: 'Your last renewal did not go through. Update your payment method to keep Supporter features.',
  },
  pending: {
    title: 'Payment pending',
    detail: 'Your payment has not completed yet. This page updates once it settles.',
  },
  expired: {
    title: 'Supporter ended',
    detail: 'Saved Supporter preferences are kept but inactive. Your free settings and data are untouched.',
  },
  review: {
    title: 'Membership needs review',
    detail: 'Something about this payment needs checking. Nothing is lost; support can help.',
  },
}

export function SupporterOffer({ onEntitlement }: { onEntitlement?: (value: SupporterEntitlement | null) => void } = {}) {
  const [entitlement, setEntitlement] = useState<SupporterEntitlement | null>(null)
  const [busy, setBusy] = useState(false)
  const requestId = useRef(0)
  const inFlight = useRef(false)
  const portalOrigin = usePortalOrigin()
  useEffect(() => { onEntitlement?.(entitlement) }, [entitlement, onEntitlement])

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    const id = ++requestId.current
    setBusy(true)
    try {
      const response: BackgroundResponse = await chrome.runtime.sendMessage({ type: 'SUPPORTER_ENTITLEMENT' })
      if (id !== requestId.current) return
      if (!response || !('type' in response) || response.type !== 'SUPPORTER_ENTITLEMENT') {
        throw new Error('worker unavailable')
      }
      setEntitlement(response.entitlement)
    } catch {
      if (id === requestId.current) setEntitlement({ state: 'error' })
    } finally {
      if (id === requestId.current) {
        inFlight.current = false
        setBusy(false)
      }
    }
  }, [])

  useEffect(() => {
    const changed = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (!('pulseAccountRevision' in changes || 'backendUrl' in changes || 'localBackendOptIn' in changes)) return
      // An old account's pending read must never restore access after a switch.
      requestId.current++
      inFlight.current = false
      setEntitlement(null)
      void refresh()
    }
    const storage = globalThis.chrome?.storage?.onChanged
    storage?.addListener(changed)
    void refresh()
    return () => {
      requestId.current++
      inFlight.current = false
      storage?.removeListener(changed)
    }
  }, [refresh])

  const status = entitlement?.state === 'ready' ? entitlement.status : null
  const isSupporter = status === 'active' || status === 'grace'
  // First-time visitors see the public offer before entering account billing.
  // Any prior or unresolved membership belongs on the authenticated billing
  // page, including an expired membership that may still need invoice access.
  const canOpenBilling = entitlement?.state === 'ready'
    && status !== 'none'
  const actionLabel = status === 'pending'
    ? 'Check payment status on streampulse.stream'
    : status === 'review'
      ? 'Review membership on streampulse.stream'
      : status === 'expired'
        ? 'Review your membership on streampulse.stream'
      : isSupporter
        ? 'Manage your membership on streampulse.stream'
        : 'Become a Supporter on streampulse.stream'

  return (
    <PulseSectionCard title="Supporter" headingLevel={3}>
      <div role="status" aria-live="polite">
        {!entitlement ? <p>Checking Supporter status…</p> : null}

        {entitlement?.state === 'not_linked' ? (
          <p>Connect this extension to your Pulse account above to see Supporter status.</p>
        ) : null}

        {entitlement?.state === 'unavailable' ? (
          <p>Supporter is not available on the server yet. Your free tools are unaffected.</p>
        ) : null}

        {entitlement?.state === 'error' ? (
          <p>Could not reach StreamPulse to check Supporter status. Your free tools are unaffected.</p>
        ) : null}

        {status ? (
          <>
            <p><strong>{STATUS_COPY[status].title}</strong></p>
            <p className="pulse-supporter-detail">{STATUS_COPY[status].detail}</p>
            {entitlement?.state === 'ready' && entitlement.accessUntil && isSupporter ? (
              <p className="pulse-supporter-detail">
                Access through {new Date(entitlement.accessUntil).toLocaleDateString()}.
              </p>
            ) : null}
            {entitlement?.state === 'ready' && entitlement.supportPeriods > 0 ? (
              <p className="pulse-supporter-detail">
                {entitlement.supportPeriods} supported {entitlement.supportPeriods === 1 ? 'month' : 'months'} so far.
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      {status === 'none' || status === 'expired' ? (
        <>
          <dl className="pulse-supporter-terms">
            <dt>Price</dt><dd>{PRICE_DISPLAY}</dd>
            <dt>Renews</dt><dd>Monthly, until you cancel</dd>
            <dt>Cancel</dt><dd>Any time; access runs to the end of the paid month</dd>
            <dt>You get</dt><dd>A private Pulse header accent, three accent finishes, and private support recognition</dd>
          </dl>
          {/* The "You get" row lists only shipped benefits, and the chat badge
              has its own card, so it is not restated here. */}
          <p className="pulse-supporter-detail">
            Taxes, if any, are shown before you pay.
          </p>
        </>
      ) : null}

      <div className="pulse-account-link-actions">
        {/* Checkout and billing management both need a browser session, so both
            are handled on the website rather than in the extension. */}
        {entitlement ? (
          <a
            data-supporter-action="billing"
            href={productLink(canOpenBilling ? 'billing' : 'supporter', portalOrigin)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {actionLabel}
          </a>
        ) : (
          <span data-supporter-action="billing" aria-disabled="true">
            Checking Supporter status…
          </span>
        )}
        <button type="button" disabled={busy} onClick={() => void refresh()}>
          {busy ? 'Checking…' : 'Refresh status'}
        </button>
      </div>

      <p className="pulse-supporter-detail">
        Core Pulse tools, your existing accent themes and ordinary clip downloading remain free.
      </p>

      <p className="pulse-supporter-detail pulse-supporter-policies">
        <a href={POLICY_LINKS.terms} target="_blank" rel="noopener noreferrer">Supporter terms</a>
        <a href={POLICY_LINKS.refunds} target="_blank" rel="noopener noreferrer">Cancellation &amp; refunds</a>
        <a href={POLICY_LINKS.privacy} target="_blank" rel="noopener noreferrer">Privacy</a>
      </p>
    </PulseSectionCard>
  )
}
