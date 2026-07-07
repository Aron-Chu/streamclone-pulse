---
name: writing-plans
description: Use when you have a spec or requirements for a multi-step task, before writing any code
---

# Writing Plans

## Overview

Write a comprehensive implementation plan assuming the engineer has zero context on our codebase and questionable taste. Document everything they need to know: which files each task modifies, the code, the tests, the docs they may need to consult, how to test. Break the whole plan into small-step tasks. DRY. YAGNI. TDD. Commit frequently.

Assume they are an experienced developer but know almost nothing about our toolchain and problem domain. Assume they are not great at test design.

**Announce at the start:** "I'm using the writing-plans skill to create an implementation plan."

**Where plans are saved:** `docs/superpowers/plans/YYYY-MM-DD-<name>.md`
- (the user's preference for plan location takes precedence over this default)

## Scope check

If the spec covers multiple independent subsystems, it should have been split into subproject specs during the brainstorming phase. If not, recommend splitting it into separate plans — one per subsystem. Each plan should independently produce working, testable software.

## File structure

Before defining tasks, list the files to be created or modified and the responsibility of each. This is where you lock in the decomposition decisions.

- Design units with clear boundaries and well-defined interfaces. Each file should have one clear responsibility.
- You reason best about code that fits into context at once, and your edits are more reliable the more focused a file is. Prefer small, focused files over large files that do too much.
- Files that change together should live together. Split by responsibility, not by technical layer.
- In an existing codebase, follow established patterns. If the codebase uses large files, don't unilaterally refactor — but if the file you're modifying has already become unmanageable, it's reasonable to include a split in the plan.

This structure determines the task decomposition. Each task should produce an independent, meaningful change.

## Small-step task granularity

**Each step is one action (2-5 minutes):**
- "Write a failing test" - one step
- "Run it to confirm it fails" - one step
- "Write the minimal code to make the test pass" - one step
- "Run the test to confirm it passes" - one step
- "Commit" - one step

## Plan document header

**Every plan must start with this header:**

```markdown
# [Feature Name] Implementation Plan

> **For the AI agent working this:** Required sub-skill: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task.

**Goal:** [one sentence describing what to build]
**Architecture:** [2-3 sentences describing the approach]
**Tech stack:** [key technologies/libraries]
```

## Task structure

Each task includes:
- **Files:** the exact paths to create/modify/test
- **Steps:** concrete implementation steps with code blocks
- **Verification:** the exact commands and expected output
- **Commit:** a separate commit per task

## No placeholders

Every step must contain the actual content the engineer needs. The following are **plan defects** — never write them:
- "TBD", "TODO", "implement later", "fill in details later"
- "add proper error handling" / "add validation" / "handle edge cases"
- "write tests for the code above" (without the actual test code)
- "similar to task N" (duplicate the code — the engineer may not read tasks in order)
- steps that only describe what to do without showing how (code steps must have code blocks)
- references to types, functions, or methods not defined in any task

## Notes
- Always use exact file paths
- Include complete code in every step — if a step involves a code change, show the code
- Exact commands and expected output
- DRY, YAGNI, TDD, commit frequently

## Self-check

After writing the complete plan, review the spec with fresh eyes and check the plan against it:

**1. Spec coverage:** Walk through every section/requirement in the spec. Can you point to the task that implements it? List any omissions.

**2. Placeholder scan:** Search the plan for red flags — any of the patterns in the "No placeholders" section above. Fix them.

**3. Type consistency:** Are the types, method signatures, and property names used in later tasks consistent with those defined in earlier tasks? Calling it `clearLayers()` in task 3 but `clearFullLayers()` in task 7 is a bug.

If you find a problem, fix it inline. No need to re-review — fix it and move on. If you find a spec requirement with no corresponding task, add a task.

## BaJie-MCP integration notes

This skill is used by the BaJie-MCP control center during §5.5 Step 2 task decomposition. When the control center breaks down a complex task, it references this skill's methodology to create the subtask checklist.
