# Optional public website product analytics

Website product analytics are a separate, voluntary choice from StreamPulse's
Twitch reaction analytics. They start off. The visitor can allow or withdraw them
through **Analytics preferences** in either public footer. Account pages,
dashboards, all `/analytics` routes and unknown routes are excluded.

The only admitted page paths are `/`, `/docs`, `/status`, `/privacy`, `/terms`,
`/refunds`, `/supporter` and `/support`. Page categories and calls to action use
fixed enums; no URL, query, fragment, link text, form value, channel name or
account identity is admitted.

| Event | Properties |
| --- | --- |
| `portal_public_page_viewed` | `page_category`: home, docs, status, privacy, terms, refunds, supporter or support |
| `portal_public_cta_clicked` | Same `page_category`; `cta`: install_extension or open_analytics |

Each event also sets `$process_person_profile=false` and `$geoip_disable=true`.
The capture API envelope carries the public project token, a random identifier
kept only in page memory, a newly generated event UUID and an internal timestamp.
The identifier is discarded on withdrawal or entry into an excluded route.
Reloading or a new analytics client generates another identifier.

Only the preference (`allowed` or `declined`) is saved, under
`sp.websiteAnalytics.v1` in local storage. If storage is unavailable, a choice
works in the current tab. Global Privacy Control and Do Not Track keep capture
off even if a previous choice allowed it. Builds without a valid public project
token or without native beacon/UUID support display analytics as unavailable.

The build input is `VITE_POSTHOG_PROJECT_TOKEN`; supply it through the process
environment, never a committed token or local environment file. The only allowed
ingestion origin is `https://us.i.posthog.com` in both CSP policies. Production
enablement must verify that the intended project's **Discard IP data** setting
is on. Network transmission inherently exposes the source IP to the processor;
event properties and GeoIP enrichment do not store it.

The client uses PostHog's documented [single-event capture API](https://posthog.com/docs/api/capture#single-event)
through native `sendBeacon`, with no SDK, automatic collection, person profiles,
recordings, flags, surveys, remote scripts, fallback transport, retry queue or
unload flush. A refused or thrown beacon is dropped; there is no later catch-up.
Withdrawal prevents new attempts. A beacon already accepted by the browser
cannot be recalled, and browser acceptance is not proof of vendor ingestion.

Local privacy checks cover consent/import races, browser privacy signals, private
routes, storage failure, fixed envelopes, generated identifiers, rejected beacons
and withdrawal. Hosted acceptance separately requires a real opt-in event in the
intended project. A generic PostHog web-analytics health check that expects
`$pageview` does not justify enabling automatic pageviews.
