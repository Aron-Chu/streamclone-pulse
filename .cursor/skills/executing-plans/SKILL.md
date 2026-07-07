---
name: executing-plans
description: Use when you have a written implementation plan to execute in a separate session, with review checkpoints
---

# Executing Plans

## Overview

Load the plan, review it critically, execute all tasks, and report when done.

**Announce at the start:** "I'm using the executing-plans skill to implement this plan."

## Process

### Step 1: Load and review the plan

1. Read the plan file
2. Review critically — identify any problems or concerns in the plan
3. If there are concerns: raise them with your human partner before starting
4. If there are no concerns: create a TodoWrite and continue

**When reviewing, focus on:**
- Are there missing dependencies between steps? (A depends on B, but B comes after A)
- Are the verification conditions explicit? ("confirm it works" doesn't count; "run `npm test`, all pass" does)
- Are there implicit environment assumptions? (Node version, database connection, API key)

**Review example:**
```
Plan file: docs/plan.md
Task list: 5 tasks

Review findings:
- Task 3 (add database migration) should come after task 2 (write the data model); the order is correct ✓
- Task 4's verification says "confirm the feature works" → needs clarification: exactly which tests to run?
- The plan doesn't mention the Python version requirement → needs confirmation
```

### Step 2: Execute the tasks

For each task:

1. **Mark in progress** — update TodoWrite
2. **Understand the goal** — reread the task description, clarify the completion criteria
3. **Implement** — follow the plan steps exactly (the plan already has small steps)
4. **Run verification** — run the tests or checks as required
5. **Commit the changes** — commit once per completed task, with a commit message referencing the task number
6. **Mark complete** — update TodoWrite

**The rhythm of each task:**
```
--- Task 2/5: Add user validation ---
[mark in progress]

Goal: add input validation to /api/users
Completion criteria: all validation tests pass, invalid input returns 400

[implement]
- Add validateUser() middleware
- Write 3 validation rules (email format, password strength, username length)

[verify]
$ npm test -- --grep "validation"
  ✓ rejects invalid email (12ms)
  ✓ rejects weak password (8ms)
  ✓ rejects overly long username (5ms)
  3 passing

[commit]
$ git add src/middleware/validate.js tests/validation.test.js
$ git commit -m "feat: add user input validation (task 2/5)"

[mark complete]
--- Task 2/5 done ---
```

**Batch review checkpoint:**
- After every 3 tasks, pause and review: is the overall direction still right? Has anything drifted from the plan?
- If you find a problem in earlier implementation, fix it before continuing — don't carry the problem forward

### Step 3: Handle common exceptions

**Test failure:**
1. Read the error message, locate the cause of failure
2. Distinguish: is it an implementation bug? a problem with the test itself? or an error in the plan description?
3. Implementation bug → fix and rerun
4. Test problem → fix the test, explain to your partner
5. Plan error → stop, report to your partner and suggest a correction

**Missing dependency:**
```
Task 3 needs a Redis connection, but the plan doesn't mention Redis configuration.
→ Stop execution
→ Report to your partner: "Task 3 needs Redis, but the plan has no configuration step.
   Suggestion: insert a 'configure Redis connection' step before task 3."
```

**Unclear instructions:**
- Don't guess intent, don't "reasonably infer"
- List your understanding and your confusion, and have your partner clarify
- Wait for a reply before continuing

### Step 4: Complete development

After all tasks are done and verified:

**Completion report template:**
```
## Execution Report

**Plan:** docs/plan.md
**Branch:** feature/user-validation
**Tasks:** 5/5 done

### Completed tasks
1. ✅ Initialize project structure
2. ✅ Add user validation
3. ✅ Add database migration
4. ✅ Implement API endpoints
5. ✅ Add integration tests

### Verification results
- Unit tests: 23/23 pass
- Integration tests: 8/8 pass
- Lint check: 0 warnings

### Deviations from the plan
- Task 3: Redis config moved from env to config.yaml (with the partner's agreement)
```

## When to stop and ask for help

**Stop execution immediately when:**
- You hit a blocker (missing dependency, test failure, unclear instructions)
- The plan has a serious flaw that prevents starting
- You don't understand an instruction
- Verification fails repeatedly (the same test fails more than twice)

**When unsure, ask — don't guess.**

## Notes
- Review the plan critically first
- Follow the plan steps exactly
- Don't skip verification
- Commit each task separately, with a commit message referencing the task number
- Stop when blocked — don't guess
- Never start implementing on the main/master branch without the user's explicit agreement

## BaJie-MCP integration notes

This skill is used by BaJie-MCP execution roles (feature_dev / backend_dev, etc.) when they receive a task that comes with a plan.
