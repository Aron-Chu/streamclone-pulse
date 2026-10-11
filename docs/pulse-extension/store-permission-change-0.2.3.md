# 0.2.3 store permission change: `identity` for Continue with Twitch

Status 2026-10-10: **DRAFT** for the owner's store submissions. Nothing here is
submitted. The text marked DRAFT needs Aron's approval.

## What changes in the package

The release commit ("release(extension): 0.2.3 turns on Continue with Twitch
for Chrome Web Store and Firefox") is the only change that turns sign-in on in a
store build. In one commit it:

- adds `"identity"` to `permissions` in `manifests/cws.json` and
  `manifests/firefox.json` (never `identity.email`);
- adds `cws` and `firefox` to `SIGN_IN_PUBLIC_TARGETS` in
  `scripts/extension-permission-allowlists.mjs`, so the package validator's exact
  allowlist expects it;
- moves every manifest and `package.json` to 0.2.3 and adds the release note.

A store build's sign-in stage is derived from its manifest
(`scripts/extension-target.mjs`): `identity` present means `public`, absent means
`off`. `PULSE_EXTENSION_TWITCH_SIGNIN`, if set, must agree or the build fails, so
a package can neither request `identity` without using it nor turn sign-in on
without the permission. `manifests/edge.json` stays without `identity` until the
Edge listing ID is registered with Twitch
([`twitch-signin-redirects.md`](./twitch-signin-redirects.md)).

Sign-in code lives in the worker and the options page only. The content script
is unchanged and stays under the 168,300-byte gzip budget.

## Chrome Web Store

- `identity` shows no install-time warning (only `identity.email` does), so
  existing users are not disabled on update. The update still goes through
  review with a permission justification.
- Justification (**DRAFT**): "identity is used only when the user clicks
  Continue with Twitch: chrome.identity.launchWebAuthFlow opens Twitch's sign-in
  page and returns a one-time ID token that the extension sends to
  api.streampulse.stream to sign the user in. No Google account access, no
  identity.email."
- Privacy-practices disclosures to update:
  - Authentication information: the one-time Twitch ID token, sent once to
    api.streampulse.stream at sign-in.
  - Personally identifiable information: the Twitch user ID inside that token,
    stored server-side only as a keyed hash.
  - Website content and activity: synced history, only if history sync ships in
    the same release.
- Keep the Support URL change (`https://streampulse.stream/support/`).

## Edge Add-ons

Same justification and listing privacy answers in Partner Center, submitted
after the Edge ID is registered as a Twitch redirect and added to the backend
list. Until then the Edge package carries no `identity` and points purchases at
streampulse.stream.

## Firefox Add-ons (AMO)

- The `identity` permission, with the same justification in the reviewer notes.
- Data collection: the sign-in sends an authentication token. Proposal (needs
  verification by the multi-browser lane against AMO policy **before** the
  release commit is used): declare `"optional": ["authenticationInfo"]` under
  `browser_specific_settings.gecko.data_collection_permissions` and request it
  from the click that starts sign-in. The release commit on this branch does not
  change `data_collection_permissions`; that lane owns Firefox package
  validation.
- Source submission as today.

## Release order

1. The site with Continue with Twitch first (portal before extension).
2. The redirects in `twitch-signin-redirects.md` registered on StreamPulseProd and
   in `PULSE_TWITCH_SIGNIN_REDIRECTS`.
3. Chrome Web Store and AMO 0.2.3 submissions.
4. Edge once its listing ID is registered.
