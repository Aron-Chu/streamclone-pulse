---
name: backfill-safety-review
description: Review VOD backfill jobs, rate limits, and capacity before enabling or widening backfill. Use when changing PulseBackfillManager, backfill API routes, job polling, or "Load missed moments" triggers.
---

# Backfill safety review

**Canonical copy:** `../streampulse-backend/.cursor/skills/pulse/backfill-safety-review/SKILL.md`

Use the canonical skill in **streampulse-backend** for the full safety checklist, merge-block criteria, and smoke scripts.

This stub exists so Cursor discovers the skill from the streamclone-pulse checkout. Always target `https://api.streampulse.stream` for smoke probes — do not use local `:8090`.
