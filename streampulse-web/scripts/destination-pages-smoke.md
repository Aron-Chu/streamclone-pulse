# Destination Pages smoke

This prepares a read-only check for the migration project's production
deployment while the public route still points to the existing project. It
does not deploy, attach a route, use a backend credential, or send account data.

Before executing, retrieve the exact production deployment through an
**authenticated Cloudflare Pages control-plane lookup** for the independently
verified destination account and migration project. Retrieve the project and
the exact deployment; the latter must report a successful production
deployment. Pass a filtered in-memory JSON object on stdin:

The object must have `accountId` and `projectName` fields, plus `project` with
`id`, `name` and `subdomain`, and `deployment` with `id`, `short_id`,
`project_id`, `project_name`, `url`, `environment`, and `latest_stage.name`
and `.status` from the authenticated lookups.

Use only the account and project that were actually queried and fields returned
by that lookup; do not save the response, identifiers or credentials to a file.
Supply the independently checked expected account, exact deployment identifier,
unique deployment URL, project subdomain, and current canonical origin through
these environment variables for this process: `PAGES_SMOKE_EXPECTED_ACCOUNT_ID`,
`PAGES_SMOKE_EXPECTED_DEPLOYMENT_ID`, `PAGES_SMOKE_EXPECTED_DEPLOYMENT_URL`,
`PAGES_SMOKE_EXPECTED_PROJECT_SUBDOMAIN`, and `PAGES_SMOKE_CANONICAL_ORIGIN`.
Set `PAGES_SMOKE_ALLOW_NETWORK=yes` only
when the operator is ready for the read-only requests. Then run
`node scripts/destination-pages-smoke.mjs` with the filtered JSON on stdin.

The code compares the evidence with those expected values and selects the URL
from the evidence; it requires the URL hostname to match the deployment short
identifier plus the looked-up project subdomain, rejecting project roots,
branch aliases, other hosts and redirects. These comparisons are only
as trustworthy as the authenticated lookup and independent checks. The script
does **not** authenticate stdin JSON itself, prove the selected account from two
matching manually supplied values, or verify the Pages secret value. It prints
fixed outcomes only and does not log the URL, identifiers, cookies or bodies.
Requests use a dedicated HTTPS agent, not the process's global proxy agent; they
do not follow redirects, send credentials or accept credentials in the URL.

The preview check validates the application shell on three static routes, not
rendered pages or asset loading, and expects the account relay
to reject a request from the preview origin. The current pinned Worker accepts
that relay only on its canonical origin. The preview refusal is not proof that
the binding exists or matches the backend: it occurs before the binding check.
An HTTP 401 on a later account request is also not proof of a valid signature;
the backend can fall back to another identity when signature verification fails.

After an authorized route change, test the canonical route separately. Use
trusted backend instrumentation to observe accepted and invalid edge-signature
counter changes around a controlled request, including mismatch and stale
reasons; account for concurrent traffic and trusted-proxy configuration. If the
request cannot be attributed or the counters cannot be observed, signature
acceptance remains unverified. Do not rotate a secret, modify the backend, or
enable a production route as part of this preparation.

Local offline tests: `node --test scripts/destination-pages-smoke.test.mjs`.

After an upload the CLI waits two seconds, then retries transient request,
document or relay-propagation failures after two, four and eight seconds.
There are at most four attempts and a 45-second overall budget, including waits
and requests. Every attempt uses the same identity, shell and refusal checks;
incorrect identity and redirects fail immediately. Refused response bodies are
cancelled. A timeout or exhausted retries still fails the smoke. Retry lines
contain only the attempt number and a fixed reason, with no URL or error text.
The wait happens after authenticated deployment evidence has been validated;
this does not make an unready or wrong deployment eligible for checking.
