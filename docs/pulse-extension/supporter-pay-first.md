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
same generic email-sent response, then waits for explicit email-link approval.
The worker receives the restored credential family privately. Accounts with
billing history are never merged. **Use a StreamPulse website account** preserves
the secondary email-account connection flow for existing users.

The installation endpoint returns 404 while its feature flag is off. The extension
then uses the existing website-account journey. An absent capability on an older
linked account also keeps website billing. An outage, closed Checkout or a billing
environment this build does not honor cannot open a new payment.

Credentials, bootstrap keys, restore polling secrets and provider URLs remain in
extension-origin IndexedDB. Account and billing messages are extension-page-only;
Twitch receives only the bounded appearance projection. Requests use the fixed
hosted backend, `credentials: 'omit'`, `redirect: 'error'` and request deadlines.
Navigation accepts exact HTTPS Stripe hosts, with no userinfo or nonstandard port.
Checkout's provider fragment is preserved, including when reopening the same
private URL; settings never receives that URL.

Payment and restore waits survive settings closing and worker restart. Their
worker keep-alive is bounded to fifteen minutes or an earlier server deadline,
stops on a terminal result or loss of the waiting identity, and adds no manifest
permission. Focus can request a fresh status afterward. A lost payment response,
unknown outcome or old-account attempt remains a barrier against another payment.
Restoring another active account can still open that account's own Customer
Portal without discarding the older payment uncertainty.

Anonymous bootstrap retries reuse a pending key. Rejected credentials discard
their claimed key, and explicit recovery can create a fresh empty waiting
installation. A stale approved restore response is never adopted after disconnect;
the worker best-effort revokes the newly issued credential family. A response lost
entirely cannot be disposed by the client, because it never learned that family.

All pay-first proof uses disposable fixture profiles and mocked APIs. It proves
neither real email delivery nor real Stripe payment, hosted lifecycle timing,
owner-browser behavior or Store publication. Development source changes require
a fresh build and a development extension reload; normal Store users are not
asked to rebuild or reload as part of buying Supporter.
