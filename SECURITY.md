# Security Policy

## Supported versions

Security fixes target the latest extension/portal release candidate on `master`.
Store uploads are gated by RPR-9 (store release pending) and may lag `master`.

## Reporting a vulnerability

**Do not** open a public GitHub issue with exploit details, payloads, or credentials.

### GitHub Private Vulnerability Reporting (enabled)

This repository has **GitHub Private Vulnerability Reporting (PVR) enabled**.

Prefer reporting through GitHub’s private advisory / vulnerability reporting UI for
[`Aron-Chu/streamclone-pulse`](https://github.com/Aron-Chu/streamclone-pulse):

**Security → Report a vulnerability** (or the repository’s Security advisories flow).

That is the preferred channel for security findings about this public client
repository.

### Interim contact

There is **no** verified dedicated `security@` mailbox. For privacy or legal
concerns only, you may contact `privacy@streampulse.stream` (interim; not a
substitute for PVR or a security mailbox).

1. Do **not** send exploit details, proof-of-concept code, or secrets to public
   issues, discussions, or pull requests.
2. If you must open a public issue to request a private follow-up, include only a
   high-level impact summary with no reproduction steps that enable abuse.

## Hosted vs self-built

StreamPulse hosted APIs and private ops are out of scope for this public client
repository’s issue tracker. Do not paste production topology, env files, or
operator paths here.

## License

Source in this repository is intended to be Apache-2.0 (see [`LICENSE`](LICENSE)).
Twitch and third-party trademarks belong to their owners.
