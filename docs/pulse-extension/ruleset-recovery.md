# Owner ruleset recovery (RPR-8)

**Audience:** repository owner only (`Aron-Chu`).  
**Purpose:** recover from a ruleset misconfiguration that blocks merges or
admin push without rewriting history or deleting archive evidence.

## Active ruleset (clean public repo)

| Field | Value |
|-------|--------|
| Repository | `Aron-Chu/streamclone-pulse` (public) |
| Ruleset name | `default-branch` |
| Ruleset id | `19748279` |
| Target | `refs/heads/master` |
| Enforcement | `active` |
| Bypass actors | **none** (admins are not exempt) |
| Required check | context `CI` (final gate job) |
| Reviews | 0 approvals; conversation resolution required |
| Merge methods | squash only (repo + ruleset) |
| Extra | block branch deletion; block non-fast-forward |

Repo settings companion: squash-only merges; merge commit and rebase disabled;
`GITHUB_TOKEN` workflow permissions default to **read**.

## Recovery procedure (owner)

Use when a bad ruleset change locks merges, required checks cannot complete, or
an emergency hotfix must land outside normal PR flow.

1. **Prefer a temporary enforcement change over deletion.**  
   Set the ruleset to `evaluate` (or disable temporarily) via GitHub UI
   (**Settings → Rules → Rulesets → `default-branch`**) or API:
   `PUT /repos/Aron-Chu/streamclone-pulse/rulesets/19748279` with
   `"enforcement": "disabled"` (or `"evaluate"`).
2. **Land the fix** through the smallest possible change (prefer PR once
   checks can run; direct push only if CI/ruleset itself is the outage).
3. **Re-enable** the same ruleset (`enforcement: active`) with the intended
   rules. Do **not** leave bypass actors populated for routine operation.
4. **Verify** with a docs-only PR that the required `CI` context is still
   reported and that squash is the only merge method.
5. **Do not** rewrite history, force-push `master`, or delete
   `streamclone-pulse-private-archive` evidence as part of recovery.

## Break-glass notes

- Empty `bypass_actors` means the owner must use ruleset disable/evaluate for
  recovery — that is intentional for solo-owner honesty.
- Restoring from a prior ruleset JSON export is fine; keep id `19748279` or
  recreate with the same semantics and update this document’s id.
- Backend/ops remain private and have separate solo-owner rulesets; do not
  copy Pulse visibility assumptions onto those repos.

## Related

- Program status: [`reliability-public-release-plan.md`](./reliability-public-release-plan.md)
- Cutover evidence: [`../evidence/RPR-7-9-public-cutover-20260726.md`](../evidence/RPR-7-9-public-cutover-20260726.md)
