# Optional public website product analytics

Website product analytics are a separate, voluntary choice from StreamPulse's
Twitch reaction analytics. They start off. The visitor can allow or withdraw them
through **Analytics preferences** in either public footer. Account pages,
dashboards, unlisted `/analytics` routes and unknown routes are excluded. Only
explicitly generated public summary/recap paths are admitted from `/analytics`.

The only admitted page paths are `/`, `/docs`, `/status`, `/privacy`, `/terms`,
`/refunds`, `/supporter`, `/support`, the timestamp-link tool and the two published
guides, plus the explicitly generated public summaries. Page categories and calls to action use
fixed enums; no visitor URL, query, fragment, link text, form value, channel name
or account identity is admitted. The optional feedback form accepts only the
fixed answer described below.

| Event | Properties |
| --- | --- |
| `portal_public_page_viewed` | `page_category`: home, docs, status, privacy, terms, refunds, supporter, support, tool, guide, channel_summary or stream_recap |
| `portal_public_cta_clicked` | Same `page_category`; `cta`: install_extension or open_analytics |
| `portal_public_tool_completed` | `page_category`: tool; `tool`: twitch_vod_timestamp_link; `outcome`: link_built |
| `survey shown` | `page_category`: tool; `tool`: twitch_vod_timestamp_link; fixed `$survey_id`; `$survey_iteration` |
| `survey sent` | Same survey properties; generated `$survey_submission_id`; `$survey_completed`: true; fixed `$survey_questions`; fixed question's `$survey_response_<question_id>`: Yes or Not yet |
| `survey dismissed` | Same properties as `survey shown`; no answer |

The tool event records a successfully constructed timestamp link, not a clipboard
copy, replay verification or share. No entered value or generated URL reaches the
capture method. Repeated valid builds are repeated observations, not unique users.
This scope requires a new choice under `sp.websiteAnalytics.v4`; older choices do
not opt visitors into the expanded scope. DNT/GPC and withdrawal still prevail.
The tool-completion event and feedback submission are separate observations:
building a link does not automatically open or submit the question.

Each event also sets `$process_person_profile=false` and `$geoip_disable=true`.
The capture API envelope carries the public project token, a random identifier
kept only in page memory, a newly generated event UUID and an internal timestamp.
The identifier is discarded on withdrawal or entry into an excluded route.
Reloading or a new analytics client generates another identifier.

Only the preference (`allowed` or `declined`) is saved, under
`sp.websiteAnalytics.v4` in local storage. If storage is unavailable, a choice
works in the current tab. Global Privacy Control and Do Not Track keep capture
off even if a previous choice allowed it. Builds without a valid public project
token or without native beacon/UUID support display analytics as unavailable.

The build input is `VITE_POSTHOG_PROJECT_TOKEN`; supply it through the process
environment, never a committed token or local environment file. The only allowed
ingestion origin is `https://i.streampulse.stream` in both CSP policies. This is
PostHog's managed reverse proxy, which routes through Cloudflare as a PostHog
subprocessor. It forwards single-event captures and the explicitly requested
survey-definition lookup; it does not enable an SDK or automatic collection.
Consent, GPC and DNT remain required before either request. DNS and certificate
readiness do not establish that
a website release uses this endpoint or that an event was ingested. Production
enablement must verify that the intended project's **Discard IP data** setting
is on. Network transmission inherently exposes the source IP to the processor;
event properties and GeoIP enrichment do not store it.

The client uses PostHog's documented [single-event capture API](https://posthog.com/docs/api/capture#single-event)
through native `sendBeacon`, with no SDK, automatic collection, person profiles,
recordings, runtime feature flags, remote scripts, fallback transport, automatic
retry queue or unload flush. A refused or thrown page, CTA or tool-completion
beacon is dropped. Feedback has only the explicit retry described below.
Withdrawal prevents new attempts. A beacon already accepted by the browser
cannot be recalled, and browser acceptance is not proof of vendor ingestion.

## Optional timestamp-tool feedback

After a successful clipboard copy, the tool offers **Give anonymous feedback**
only while website analytics are allowed. The visitor must open it explicitly.
Opening requests `/api/surveys/` through the same managed proxy, using the public
project token with credentials omitted, no referrer, no cache, no redirects and
a four-second timeout. No survey definition is requested before consent or just
because a link was built or copied. A failed or incompatible lookup leaves the
tool usable and offers a manual retry.

The renderer accepts one fixed API survey and one required single-choice
question: **Did this tool help you create the Twitch timestamp link you needed?**
Its only answers are **Yes** and **Not yet**. There is no free-text field. The
question, choices and IDs must match the constants in
[`timestampFeedback.ts`](../../streampulse-web/src/lib/timestampFeedback.ts).
Changed questions, linked or targeting flags, and nonempty targeting conditions
are rejected rather than silently ignored. The definition must use the
repeatable `always` schedule; it requires no persistent person or seen-state
properties. The public definition endpoint filters out draft, ended and
archived surveys; the client also rejects an explicitly archived definition.
See PostHog's [API survey implementation guide](https://posthog.com/docs/surveys/implementing-custom-surveys).

Rendering counts `survey shown`. Only **Send feedback** captures the selected
answer; **Not now** counts `survey dismissed` after the question was shown.
Survey events share the capture client's temporary page-memory identifier and
set the same no-profile and no-GeoIP properties. The question definition and
generated submission ID are protocol metadata; entered links and timestamps
are excluded. No `$set` person properties, cookies, persistent identifier or
survey-seen storage are written.

If a submission beacon is refused or throws, the visitor may explicitly retry
the selected answer. The answer is locked after the first attempt; retries reuse
the entire original payload, including event UUID, timestamp and submission ID.
There is no automatic retry or later catch-up. A browser-accepted submission or
dismissal ends that tool component's feedback interaction. Reloading or a new
tool visit can offer the question again; this is not a per-person response limit.
The native survey's response limit is an operator setting, not a client quota.

Withdrawal or a browser privacy block prevents subsequent lookup/capture; the
component aborts its pending request and invalidates the session when consent
is withdrawn or the component unmounts. Lookup/import races recheck consent
before displaying or sending anything. These controls cannot recall requests
already transmitted.

## Event retention

The production project's event retention is configured to six calendar months.
Expired events are permanently deleted at the following monthly cleanup, so this
is not an exact 180-day deletion deadline. The window applies to website events,
tool-feedback events and future extension aggregate events in that project; it
does not change publisher snapshot rows in Data Warehouse tables. Reverify the
project setting before extension activation. A saved retention setting is not
evidence that ingestion is enabled or cleanup has already executed. See
PostHog's [event-retention API](https://posthog.com/docs/api/events-retention).

Local privacy checks cover consent/import races, browser privacy signals, private
routes, storage failure, fixed envelopes, generated identifiers, rejected beacons
and withdrawal, plus fixed survey definitions, explicit opening, response retry
deduplication and cancellation. Hosted acceptance separately requires real
opt-in event UUIDs and the correct survey response in the intended project; a
local test or accepted beacon does not prove ingestion. Controlled acceptance
data is not customer sentiment or conversion performance. A generic PostHog
web-analytics health check that expects
`$pageview` does not justify enabling automatic pageviews.

Chrome store links use a fixed source (`streampulse.stream`), referral medium and
`website_install` campaign. Their content value carries only the existing
allowlisted page category, with `site` as the fallback. The URL is built from
the canonical listing, so incoming campaign parameters, paths, fragments and
channel/account identifiers are never forwarded. Firefox and Edge links remain
their canonical listings. These tags describe a link's placement, not a verified
extension install or the visitor's original acquisition source.
