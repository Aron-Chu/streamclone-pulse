---
name: api-contract-drift-check
description: Detect drift between extension/portal clients and streampulse-backend BFF contracts. Use when changing extension API types, publicHub.ts, pulse-core adapters, or portal routes.
---

# API contract drift check

**Canonical copy:** `../streampulse-backend/.cursor/skills/pulse/api-contract-drift-check/SKILL.md`

Use the canonical skill in **streampulse-backend** for the full workflow, Go contract tests, and merge-block checklist.

This stub exists so Cursor discovers the skill from the streamclone-pulse checkout. Do not run local `:8090` probes here — the portal and extension default to `https://api.streampulse.stream`.
