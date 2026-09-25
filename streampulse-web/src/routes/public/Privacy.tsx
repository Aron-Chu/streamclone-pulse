import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { REFUNDS_PATH, SUPPORTER_PATH, TERMS_PATH } from '../../lib/externalLinks'
import { PrelaunchNotice } from './PrelaunchNotice'

/** Public privacy policy for StreamPulse (portal + Chrome extension). Current behavior only. */
export default function Privacy() {
  return (
    <PublicLayout>
      <article className="panel public-document" data-testid="privacy-policy">
        <p className="muted public-document__back">
          <Link to="/" className="text-zinc-400 hover:text-white inline-flex items-center gap-1">← StreamPulse Home</Link>
        </p>
        <header className="mb-6 border-b border-white/[0.08] pb-6">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 rounded bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Extension and website privacy
            </span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white lg:text-4xl">Privacy Policy</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Last updated: September 25, 2026 · Applies to <code className="font-mono text-zinc-300">streampulse.stream</code> and the StreamPulse Chrome extension.
          </p>
        </header>

        <PrelaunchNotice />

        <section className="mt-8 rounded-xl border border-white/[0.08] bg-black/20 p-6">
          <h2 className="!mt-0">Summary</h2>
          <p className="text-zinc-300">
            StreamPulse shows Twitch stream activity using minute-level aggregates from the StreamPulse
            API. The extension and public site are rollup-first: they do not expose raw chat messages or
            chatter identity to users. The extension does not use Twitch OAuth. Protect enrollment is
            optional and uses a beta access key once to create a local device credential.
          </p>
          <p className="text-zinc-300">
            An account is optional and needs only an email address. Pulse Supporter is an optional paid
            subscription, and paid sign-ups are not open yet; once they are, card details go to Stripe
            and never to StreamPulse. Neither an account nor a subscription is required to use the
            extension or the public analytics.
          </p>
        </section>

        <h2>Your account, if you create one</h2>
        <p>
          An account is optional. You need one only to link the extension to a Pulse account or to
          hold a <Link to={SUPPORTER_PATH}>Supporter</Link> subscription, and paid Supporter sign-ups
          are not open yet. Creating an account stores your email address, an internal account
          identifier, and timestamps for creation and sign-in. There is no password, no name field,
          and no profile.
        </p>
        <p>
          Sign-in works by emailed link. When you request one, StreamPulse stores a hash of a
          single-use secret — not the secret itself — with a 15-minute expiry, and emails you a link
          containing it. The secret travels in the link's <strong>URL fragment</strong> (after the{' '}
          <code>#</code>), which browsers do not send to the server or include in a{' '}
          <code>Referer</code> header, so it is not written into server logs. Confirming a sign-in
          requires the same browser that requested it.
        </p>
        <p>
          Linking the extension stores a short-lived connection code, the device label you approve,
          and a device credential identifier. Approving a device does not connect your Twitch
          identity, publish anything about you, or start a subscription.
        </p>
        <p>
          Account email is used for sign-in links and for notices about your account or subscription.
          It is not used for marketing, and it is not sold, shared or used to build an advertising
          profile.
        </p>

        <h2>Payment data, if you subscribe</h2>
        <p>
          This section describes what happens once paid sign-ups open. Until then, no payment is
          taken through StreamPulse.
        </p>
        <p>
          Payments are processed by <strong>Stripe</strong>. Card numbers, CVC and billing address are
          entered on Stripe's own hosted pages and go to Stripe — StreamPulse never receives or stores
          them.
        </p>
        <p>
          What StreamPulse stores is the identifiers and state needed to know whether your membership
          is paid: a Stripe customer identifier, subscription and invoice identifiers, paid period
          start and end dates, amounts and currency, payment status, and refund or dispute state.
          These identifiers are treated as private financial references; they are never shown
          publicly or attached to a badge or profile.
        </p>
        <p>
          Provider webhook notifications are stored in a durable queue so a payment event is never
          lost or processed twice. The proposed retention for a raw stored notification is about 30
          days after it is successfully processed, with minimal identifiers kept longer for
          de-duplication and audit; unresolved failures are not silently discarded. Server-side
          retention remains governed by operational and financial-record obligations.
        </p>
        <p>
          Chat content, viewing history, saved moments and searched channels are{' '}
          <strong>never</strong> written into billing records or used as evidence in a payment
          dispute. Only payment records and delivery state are used for that.
        </p>

        <h2>Cookies</h2>
        <p>
          StreamPulse does not use advertising, tracking or analytics cookies, and there is no consent
          banner because there is nothing optional to consent to.
        </p>
        {/* The portal reaches the account API same-origin, through the account routes on
            the apex, so these host-only cookies belong to streampulse.stream rather than
            to the API host. The extension never uses them; it holds a device credential. */}
        <p>
          Three cookies exist, all strictly necessary. They are set when you use the account pages
          on <code>https://streampulse.stream</code>, which pass your requests to the StreamPulse
          API, and all carry the <code>__Host-</code> prefix, which locks each one to that exact
          HTTPS origin:
        </p>
        <ul>
          <li>
            <strong><code>__Host-pulse_account</code></strong> — your session, set only after you
            confirm a sign-in. <code>Secure</code> and <code>HttpOnly</code>, so page JavaScript
            cannot read it, and <code>SameSite=Lax</code>.
          </li>
          <li>
            <strong><code>__Host-pulse_csrf</code></strong> — a separate value that page JavaScript
            reads and echoes back in a request header, so a third-party site cannot act on your
            behalf. It is deliberately readable and is <em>not</em> a credential on its own.{' '}
            <code>Secure</code>, <code>SameSite=Strict</code>. It expires and is revoked together
            with the session.
          </li>
          <li>
            <strong><code>__Host-pulse_login</code></strong> — set while a sign-in link is
            outstanding, so the link can only be confirmed in the browser that requested it.{' '}
            <code>Secure</code>, <code>HttpOnly</code>, <code>SameSite=Strict</code>, and it expires
            with the 15-minute challenge.
          </li>
        </ul>
        <p>
          Signing out clears all three. No cookie is set for browsing the public site, the analytics
          hub, or the documentation.
        </p>

        <h2>What the Chrome extension observes on Twitch</h2>
        <ul>
          <li>The active Twitch page URL, channel login, and stream or VOD identifiers for the tab you are viewing.</li>
          <li>Page-context Twitch metadata needed to resolve the current live stream or VOD for the overlay.</li>
          <li>
            Twitch GraphQL requests performed in the Twitch page context when needed to resolve stream or
            VOD identity for Pulse coverage and backfill flows.
          </li>
        </ul>
        <p>
           The extension does not request or transmit Twitch cookies, passwords, Twitch OAuth credentials,
           raw chat exports, or chatter identities. A beta access key is sent only to the hosted enrollment
           endpoint when you explicitly connect Protect; it is discarded after that request and is not stored
           or sent with later requests. Page-context Twitch requests may
          use your active Twitch browser session through normal browser credential handling. Those requests
          go to Twitch; StreamPulse does not receive your Twitch cookies or Twitch login credentials from
          the extension.
        </p>

        <h2>What is sent to StreamPulse</h2>
        <p>
          The extension service worker sends channel login, stream identifiers, and VOD identifiers, as
          applicable, plus aggregate Pulse and coverage requests, to{' '}
          <code>https://api.streampulse.stream</code> so sanitized rollups, coverage state, and analytics
          can be returned.
        </p>
        <p>
           Protect enrollment is a one-time beta flow. The service worker sends the key only to
           <code>https://api.streampulse.stream/v1/extension/auth/device</code>, then discards it. Later
           protected watchlist requests use an opaque bearer device token stored locally in the extension's
           trusted contexts; the token is never placed in Chrome sync storage and is not sent to local or
           custom backend origins. Without enrollment, a saved channel is only a browser-sync preference and
           is not represented as server-protected.
        </p>
        <p>
          Planned optional extension crash diagnostics are <strong>off by default</strong> and
          require an explicit Options consent toggle (“Share crash diagnostics”) before any
          sanitized report can be prepared. A separate Options toggle (“Share anonymous product
          usage”) controls default-off product analytics consent. Hosted diagnostics upload is not
          active. Product-analytics ingest is not active. The extension does not embed a Sentry or PostHog
          SDK, does not request PostHog host permissions, and does not download or evaluate remotely
          hosted challenge scripts.
        </p>
        <p>
          When product analytics is later activated by StreamPulse, consented installs may send only
          fixed aggregate event names (for example <code>pulse_load_completed</code> and{' '}
          <code>extension_error_shown</code>) through the StreamPulse backend to PostHog for
          processing. Events are non-identifying aggregates (no person profiles, no channel/stream/VOD
          identifiers, no free text). Retention target is about 180 days once activated; this page
          does not claim that activation has occurred.
        </p>

        <h2>What is stored in the browser</h2>
        <ul>
          <li>
            <strong>chrome.storage.sync</strong> — extension preferences such as theme, color scheme,
            overlay placement, chart range, watchlist entries, and related settings that may sync with your
            Chrome profile.
          </li>
          <li>
            <strong>chrome.storage.session</strong> — short-lived Pulse and coverage caches for the current
            browser session.
          </li>
          <li>
             <strong>chrome.storage.local</strong> — the local opaque device token, device identifier, and
             expiry after Protect enrollment; server-confirmed Protect sync metadata and removal tombstones;
             optional debug log entries only when debug logging is enabled; a versioned diagnostics-consent
             record when you opt in via Options (default off); and a separate versioned analytics-consent
             record when you opt in to anonymous product usage (default off). The one-time beta key is not
             stored.
          </li>
          <li>
            <strong>Extension IndexedDB</strong> (<code>pulse-account-private-v1</code>) — after you
            link the extension to a Pulse account, the account device credential is held in an
            extension-origin database reachable only from the extension's own trusted contexts, not
            from any Twitch page script. Disconnecting the extension or uninstalling it removes it.
          </li>
          <li>
            <strong>Portal localStorage</strong> — stores recently opened Twitch channel logins
            (<code>sp.hub.recentLogins</code>, capped list), public hub/analytics cache entries keyed by
            backend URL and activity window (<code>sp:publicHub:v1:…</code>, with a staleness hint of about
            10 minutes), browser-saved moments and any notes you add to them
            (<code>streampulse.saved-moments.v2</code>; an older <code>v1</code> copy may remain after
            migration), and an optional beta key (<code>sp.betaKey</code>) when a gated portal feature is
            used. Saved moments and notes are not synced to your account and remain on this browser after
            sign-out. Clearing site data for streampulse.stream removes these keys.
          </li>
          <li>
            <strong>Portal sessionStorage</strong> — may hold a developer backend URL override
            (<code>sp.backendUrlOverride</code>) in local development builds only. Production portal builds
            do not apply session backend overrides. Clearing site data removes session keys as well.
          </li>
        </ul>

        <h2>External services that receive data</h2>
        <ul>
          <li>
            <strong>StreamPulse API</strong> — the hosted analytics service at
            <code>https://api.streampulse.stream</code>.
          </li>
          <li>
            <strong>Resend (transactional email)</strong> — receives your email address and the
            sign-in message in order to deliver it. Used only for account sign-in links and account
            notices, never for marketing. Open and click tracking are switched off, so links in
            StreamPulse email are not rewritten through a tracking domain and opening an email is not
            recorded.
          </li>
          <li>
            <strong>Stripe (payments)</strong> — only if you subscribe to Supporter. Stripe receives
            your payment details directly and acts as the payment processor; StreamPulse receives
            payment status and identifiers back, not card data. See{' '}
            <Link to={REFUNDS_PATH}>cancellation and refunds</Link> for how billing is handled.
          </li>
          <li>
            <strong>Twitch</strong> — page context and GraphQL used to identify streams and VODs on
            twitch.tv.
          </li>
          <li>
            <strong>Emote CDNs</strong> — image assets from providers such as 7TV, Twitch CDN, BetterTTV,
            and FrankerFaceZ when the overlay displays emote art in the browser.
          </li>
          <li>
            <strong>PostHog (product analytics processor, planned)</strong> — only after StreamPulse
            activates the server path and only with separate default-off Options consent. The extension
            never talks to PostHog directly; the StreamPulse backend may forward fixed aggregate event
            names only. Not active in the current extension package.
          </li>
          <li>
            <strong>Website error monitoring (portal only)</strong> — when the streampulse.stream website
            build is configured with an error-monitoring DSN, the portal may send sanitized browser error
            events to that processor. This does not apply to the Chrome extension package. The portal
            scrubbing path is designed to avoid attaching users, cookies, and free-form request bodies.
          </li>
        </ul>
        <p>
          All executable JavaScript for the extension is packaged with the extension. The extension does not
          download or evaluate remotely hosted JavaScript or WebAssembly for product logic.
        </p>

        <h2>Purpose</h2>
        <p>
          Data is used to provide Pulse overlays on Twitch, honest coverage and backfill status, and public
          aggregate analytics. Account data is used to sign you in and, if you subscribe, to know whether
          your membership is paid. Data is not sold, used for advertising, or used for unrelated profiling.
        </p>

        <h2>Retention and deletion</h2>
        <p>
          Browser settings, caches, and optional debug logs remain until you clear them or uninstall the
          extension. Uninstalling removes browser storage for that installation; it does not itself delete
          server-side aggregate rollups or operational logs.
        </p>
        <p>
          A protected watchlist row is server-side state, separate from the browser-sync saved list. Removing
          a channel records a local removal tombstone until the server confirms deletion; temporary DELETE
          failures are retried. Server rows that are merely absent from local sync are not deleted. Revoking
          the device token prevents further authenticated access and removes the token's ability to manage
          Protect; token expiry and revocation are enforced by the StreamPulse backend.
        </p>
        <p>
          Server-side retention is governed by StreamPulse backend and operations configuration. This policy
          does not claim a fixed public retention period for protected watchlist rows, rollups, or operational
          logs. Browser removal and token revocation do not retroactively erase aggregate analytics.
        </p>
        <p>
          <strong>Account and billing records.</strong> Signing out ends a session but keeps the
          account. To delete an account, email the address below from the account's own address;
          sessions and device links are revoked and the account record is removed. Payment records —
          invoices, amounts and dates — are kept after deletion where financial-record or tax
          obligations require it, and are then no longer linked to an active account. Unconfirmed
          sign-in challenges expire on their own after 15 minutes. Cancelling a subscription does not
          delete the account, and deleting an account does not by itself cancel a subscription: see{' '}
          <Link to={REFUNDS_PATH}>cancellation and refunds</Link>.
        </p>

        <h2>Chrome Web Store limited use</h2>
        <p>
          User data collected through the extension is used only to provide or improve user-facing
          StreamPulse features. It is not sold or used for advertising or unrelated profiling. Transfers
          needed to operate the product include the StreamPulse API, Twitch page-context requests, and the
          emote image CDNs described above. Portal error monitoring, when enabled for the website build, is
          separate from the extension package.
        </p>

        <h2>Contact</h2>
        {/* MERGE GATE (memo T1-6): before publication the owner confirms that this
            mailbox is monitored for privacy, account-deletion and billing email, who
            answers it and the response time. If it is not monitored, replace it everywhere. */}
        <p data-testid="privacy-contact">
          For privacy or legal questions, email{' '}
          <a href="mailto:privacy@streampulse.stream">privacy@streampulse.stream</a> or visit the{' '}
          <Link to="/support">support page</Link>. That mailbox is privacy, legal and billing only —
          not routine product support.
        </p>

        <h2>Related documents</h2>
        <p>
          <Link to={TERMS_PATH}>Terms of use</Link> ·{' '}
          <Link to={REFUNDS_PATH}>Cancellation and refunds</Link> ·{' '}
          <Link to={SUPPORTER_PATH}>Supporter</Link>
        </p>

        <h2>Changes</h2>
        <p>Material changes to this policy will be reflected on this page with an updated date.</p>
      </article>
    </PublicLayout>
  )
}
