# Actions allowlist + CodeQL — public security closeout (2026-07-26)

## Actions permissions

| Setting | Value |
|---------|--------|
| Actions | enabled |
| Allowed actions | **selected** |
| GitHub-owned actions | allowed |
| Verified creator actions | allowed |
| Explicit allowlist (full SHA) | `gitleaks/gitleaks-action@ff98106e4c7b2bc287b24eaf42907196329070c7` |
| SHA pinning required | enabled when supported by API |

Workflow pins already used in `.github/workflows/ci.yml`:

- `actions/checkout@11d5960a326750d5838078e36cf38b85af677262`
- `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020`
- `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`
- `actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093`
- `gitleaks/gitleaks-action@ff98106e4c7b2bc287b24eaf42907196329070c7`

## Fork PR workflow approval

Require approval for workflow runs from **all outside collaborators** (fork PRs).

## CodeQL

GitHub code scanning default-setup API returned 404 for this repository/token.
Equivalent coverage is provided by `.github/workflows/codeql.yml` using
`github/codeql-action@4187e74d05793876e9989daffde9c3e66b4acd07` (v3) for
`javascript-typescript` with `security-extended` queries.

## React Router Dependabot

Dismissed as `vulnerable_code_not_used` — see
[`npm-audit-rpr6-2026-07.md`](./npm-audit-rpr6-2026-07.md). No React Router 8 /
React 19 force-upgrade in this program.


## Fork PR contributor approval

`approval_policy=all_external_contributors` via Actions permissions API.

