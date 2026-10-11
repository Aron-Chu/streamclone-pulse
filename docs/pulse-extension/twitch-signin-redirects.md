# Continue with Twitch: redirect URLs per store build

Status 2026-10-10: reference for the 0.2.3 release. Nothing here is registered by
this repo; the Twitch app console and the backend env are owner actions.

The extension signs in with `identity.launchWebAuthFlow`. Twitch sends the
browser back to the URL `identity.getRedirectURL()` returns, which depends on the
store build's extension ID. The worker sends its `surface` to
`POST /v1/account/auth/twitch/start-device`; the backend picks the redirect for
that surface from `PULSE_TWITCH_SIGNIN_REDIRECTS` and answers
`surface_unavailable` when there is none (the options card shows that outcome).
The worker also refuses an authorize URL whose redirect is another extension's
(`redirect_mismatch`).

Source of truth in code: `scripts/twitch-signin-redirects.mjs`, checked by
`tests/twitchRedirects.test.ts` (the Firefox value is the SHA-1 of the add-on ID
in `manifests/firefox.json`; a store can join `SIGN_IN_PUBLIC_TARGETS` only once
its redirect exists).

| Build | `identity.getRedirectURL()` | Surface sent | Backend entry |
|---|---|---|---|
| Chrome Web Store (Chrome; also Edge, Brave or Opera installs from CWS) | `https://nifgoonpcgmdhiffcpmhndjgkgahnelg.chromiumapp.org/` | `chrome` | `chrome=https://nifgoonpcgmdhiffcpmhndjgkgahnelg.chromiumapp.org/` |
| Edge Add-ons | `https://<EDGE_ID>.chromiumapp.org/` | `edge` | `edge=https://<EDGE_ID>.chromiumapp.org/` (once the ID exists) |
| Firefox Add-ons (gecko ID `streampulse@streampulse.stream`) | `https://860ca1e7899dd7ffac987c1ad8e29ba473fa0614.extensions.allizom.org/` | `firefox` | `firefox=https://860ca1e7899dd7ffac987c1ad8e29ba473fa0614.extensions.allizom.org/` |
| Development (unpacked) | `https://<dev-id>.chromiumapp.org/` (the ID follows the folder path) | by browser | StreamPulse Dev backend only |

Twitch requires https redirects (localhost aside), so Firefox uses the
`extensions.allizom.org` form, never the `http://127.0.0.1/mozoauth2/…` loopback
form. The multi-browser lane confirms the runtime value in real Firefox.

## What Aron registers

**StreamPulseProd** (the production Twitch client):

1. `https://streampulse.stream/account/twitch/callback` (already registered)
2. `https://nifgoonpcgmdhiffcpmhndjgkgahnelg.chromiumapp.org/` (already registered)
3. `https://860ca1e7899dd7ffac987c1ad8e29ba473fa0614.extensions.allizom.org/` (**new**, for the Firefox Add-ons build)
4. `https://<EDGE_ID>.chromiumapp.org/` (**new, once the Edge Add-ons listing ID exists**: Partner Center → Extension overview → Extension identity, after the first package upload). Until it is registered and in the backend list, the Edge build ships with sign-in off (no `identity` in `manifests/edge.json`).

**StreamPulse Dev** (local and preview only):

- the existing localhost callbacks, plus the real-check entries
  `https://localhost:14195/account/twitch/callback` and
  `https://fdbeakonjcncmfdeodlmaddcdfnlgamc.chromiumapp.org/`;
- for Firefox dev sign-in against the dev client, the same allizom URL as item 3
  (the gecko ID is fixed, so the redirect is too).

A development build's Chromium ID follows the folder it is loaded from. A
committed public `key` in `manifests/development.json` would pin it, but it also
changes the ID of every unpacked install already loaded from those folders
(their extension storage, saves and local history stay with the old ID), so it is
left as an owner decision rather than added here.

## Matching backend env (owner, private ops env)

```
PULSE_TWITCH_SIGNIN_REDIRECTS=web=https://streampulse.stream/account/twitch/callback,chrome=https://nifgoonpcgmdhiffcpmhndjgkgahnelg.chromiumapp.org/,firefox=https://860ca1e7899dd7ffac987c1ad8e29ba473fa0614.extensions.allizom.org/
```

Add `edge=https://<EDGE_ID>.chromiumapp.org/` when the Edge ID is registered.
