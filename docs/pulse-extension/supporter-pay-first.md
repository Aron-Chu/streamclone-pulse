# Supporter purchase and recovery from the extension

The worker starts an installation account only when a person chooses a Supporter
action. Browsing Twitch, installing the extension, reading status and previewing
a finish do not enroll an installation or start a payment.

With installation accounts enabled, **Become a Supporter** opens the server's
Stripe Checkout session directly. Stripe collects the email and payment details.
The extension follows its owned attempt and the server's membership projection;
a return page or local preference never grants access. An explicitly chosen finish
applies after verified access, including on an already-open Twitch tab.

**Manage membership** opens the current account's server-created Stripe Customer
Portal session. **Restore my Supporter** asks for the checkout email, shows the
same generic response and a six-character comparison code, then waits for
explicit email-link approval. The person confirms only when the code in their
extension matches the genuine restore page; this protects against an unsolicited
restore request. The server supplies the fixed device label.
The worker receives the restored credential family privately. Accounts with
billing history are never merged. **Use a StreamPulse website account** preserves
the secondary email-account connection flow for existing users.

The installation endpoint returns 404 while its feature flag is off. Only that
pre-enrollment refusal uses the existing website-account journey. Existing email
accounts keep website billing and its fresh-signin protections. A missing or
disabled capability after enrollment fails closed rather than sending the person
to a different website cookie account. Checkout and restore require the
server's installation-account capability and account kind; restore also requires
the server's `restoreEligible` projection for an empty installation. The backend
keeps existing installation membership reads and Stripe management available
when new installation creation is switched off. Sandbox installation accounts
require an explicit backend opt-in and nonproduction public origins. An outage or closed
Checkout cannot open a new payment.

Credentials, bootstrap keys, restore polling secrets and provider URLs remain in
extension-origin IndexedDB. Account and billing messages are extension-page-only;
Twitch receives only the bounded appearance projection. Requests use the fixed
hosted backend, `credentials: 'omit'`, `redirect: 'error'` and per-route deadlines:
40 seconds for Checkout/Portal, 25 seconds for restore start and 12 seconds for
other operations. Polls respect bounded Retry-After delays of five seconds to
24 hours, independently of the shorter worker-watch/challenge lifetime; daily
limits cannot be retried early by restarting the flow.
Navigation accepts exact HTTPS Stripe hosts, with no userinfo or nonstandard port.
Checkout's provider fragment is preserved, including when reopening the same
private URL; settings never receives that URL.

Payment and restore waits survive settings closing and worker restart. An unpaid
Checkout can be reopened until its server-reported expiry (at most 24 hours),
rather than an arbitrary UI limit. Automatic payment checks stop after thirty
minutes; a still-open unpaid session keeps **Return to Stripe checkout** and offers
**Check payment status**. A server-reported paid or pending-settlement state changes
the action to confirmation. The ordinary worker watch adds no manifest
permission. Clock expiry alone never proves a lost payment failed. **Check payment
status** can explicitly repeat Checkout on the same owned account to recover its
idempotent server attempt; background reads never repeat the mutation. Recovery
does not open a provider tab until the person chooses **Return to Stripe checkout**.

Disconnect asks for confirmation while a payment is pending or membership is paid;
disconnecting does not cancel the subscription or an in-flight payment.
Disconnect or credential loss removes the private provider URL and attempt ID
from the active journey. If a payment remains uncertain, only a domain-separated
SHA-256 account fingerprint and the server attempt deadline survive as a
non-authorizing double-payment precaution. The marker expires at that deadline;
legacy unbounded markers migrate once to a maximum twenty-four-hour precaution.
Restoring that account permits an explicit owned check; another restored active
account can manage its own membership without erasing the earlier uncertainty.
An unresolved earlier account offers Restore/Connect and support, not another
payment until its deadline. Owned expired/unpaid or active proof can clear the
corresponding marker sooner. Expiry of this local precaution grants no membership
and does not assert that an earlier payment failed.
Relink-required settings make recovery primary. Starting a separate membership
requires a second explicit confirmation and cannot override unresolved payment.

A lost restore-start response is visibly uncertain. Its private random restore
key survives for at most fifteen minutes; the email does not persist. **Check
restore request** sends only that key to recover the owned pending/approved handle,
without mailing again. An absent handle asks for email re-entry to begin a new
request. A collected challenge deletes the retry key; cancellation, expiry and
identity changes clear the waiting request. A new request is never sent blindly.

Installation accounts can list their own connected extensions and explicitly
confirm peer revocation. The current browser uses its existing Disconnect action.
The server checks ownership and revokes the peer's whole refresh family. Email
accounts retain their existing website device-management flow.

Anonymous bootstrap retries reuse a pending key. Installation refresh records keep
the existing credential and key across transient failures or worker interruption;
retries pause thirty seconds and use the server's five-minute idempotency window.
Existing email-account refresh keeps its stricter rotation semantics. An
authoritative credential rejection requests recovery while retaining the claimed
installation key. Explicit Disconnect discards it; explicit recovery can create a fresh empty waiting
installation. A stale approved restore response is never adopted after disconnect;
the worker best-effort revokes the newly issued credential family. A response lost
entirely cannot be disposed by the client, because it never learned that family.

All pay-first proof uses disposable fixture profiles and mocked APIs. It proves
neither real email delivery nor real Stripe payment, hosted lifecycle timing,
owner-browser behavior or Store publication. Development source changes require
a fresh build and a development extension reload; normal Store users are not
asked to rebuild or reload as part of buying Supporter.

For the owner-driven local sandbox only, build an unpacked development extension
with `PULSE_SUPPORTER_DEV_ORIGIN=https://localhost:8443` (or the chosen HTTPS
loopback port), then `npm run build`. The certificate must be trusted by the owner
browser. The origin is fixed for that worker build, has its own IndexedDB
namespace, and never transfers the production account's credential. This explicit
development build includes the exact local HTTPS host permission. Remove the
environment variable before normal builds. CWS/Edge/Firefox builds reject it and
retain the hosted API origin; no new dynamic backend selector is added.
