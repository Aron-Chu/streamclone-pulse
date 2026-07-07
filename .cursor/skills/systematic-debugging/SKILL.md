---
name: systematic-debugging
description: Use when you hit any bug, test failure, or unexpected behavior, before proposing a fix
---

# Systematic Debugging

## Overview

Random fixes waste time and introduce new bugs. Sloppy patches only mask deeper problems.

**Core principle:** Always find the root cause before attempting a fix. Fixing only the symptom is failure.

**Going through the motions is betraying the spirit of debugging.**

## Iron rule

```
No fix proposal without root-cause investigation
```

If you haven't finished Phase 1, you can't propose a fix.

## When to use

For any technical problem: test failures, production bugs, unexpected behavior, performance issues, build failures, integration issues.

**Especially required when:**
- Time is tight (emergencies most tempt guess-and-fix)
- It feels like "one small change" will do it
- You've already tried several fixes
- The last fix didn't work
- You don't fully understand the problem

## Four phases

You must complete each phase before moving to the next.

### Phase 1: Root-cause investigation

**Before attempting any fix:**

1. **Read the error message carefully** — don't skip errors or warnings. They often contain the solution directly. Read the full stack trace. Note line numbers, file paths, error codes.

2. **Reproduce reliably** — can you trigger it consistently? What are the exact reproduction steps? Does it reproduce every time? If you can't reproduce it → gather more data, don't guess.

3. **Check recent changes** — what change might have caused this? git diff, recent commits. New dependencies, config changes. Environment differences.

4. **Gather evidence in multi-component systems** — when the system has multiple components, add diagnostic instrumentation before proposing a fix: log the data entering and leaving each component boundary, verify the passing of environment/config, check the state at every layer. Run once to gather evidence and pinpoint where the break is.

5. **Trace the data flow** — where does the wrong value originate? Who called here with the wrong value? Keep tracing upstream until you find the source. Fix at the source, not at the symptom.

### Phase 2: Pattern analysis

1. **Find a working example** — find similar working code in the same codebase.
2. **Compare with the reference implementation** — if you're implementing a pattern, read the reference implementation in full. Don't skim — read it line by line.
3. **Identify the differences** — what's different between the working code and the broken code? List every difference, no matter how small. Don't assume "that couldn't matter."
4. **Understand the dependencies** — which other components does this feature need? What setup, config, environment does it need?

### Phase 3: Hypothesis and verification

1. **State a single hypothesis** — clearly: "I think X is the root cause, because Y." Write it down. Be specific, not vague.
2. **Test minimally** — make the smallest change to test the hypothesis. Change one variable at a time. Don't fix multiple problems at once.
3. **Verify before continuing** — did it work? Yes → go to Phase 4. No → state a new hypothesis. Don't stack more fixes on top.
4. **When you're unsure** — say "I don't understand X." Don't pretend you know.

### Phase 4: Implementation

1. **Create a failing test case** — the smallest reproduction. There must be a test before the fix.
2. **Implement a single fix** — fix the root cause you've located. Change one thing at a time. No "while I'm at it" optimizations. No bundled refactors.
3. **Verify the fix** — does the test pass now? Are other tests not broken? Is the problem really solved?
4. **If the fix doesn't work** — stop. Count: how many fixes have you tried? Fewer than 3: go back to Phase 1 and re-analyze with the new information. **3 or more: stop and question the architecture.**
5. **If 3+ fixes have failed: question the architecture** — stop and question the fundamentals: is this pattern fundamentally sound? Are we sticking with a wrong approach out of inertia? Should we refactor the architecture, or keep patching symptoms?

## Red lines — stop, follow the process

If you catch yourself thinking:
- "Let me just patch it for now and investigate later"
- "Let me try changing X and see if it works"
- "Change several places at once and run the tests"
- "Skip the test, I'll verify manually"
- "It's probably X, let me fix it"
- proposing a solution without tracing the data flow
- **"Let me try one more fix" (after already trying it more than twice)**

**All of these mean: stop. Go back to Phase 1.**

## Common excuses

| Excuse | Reality |
|------|------|
| "The problem is simple, no need for the process" | Simple problems have root causes too. For a simple bug, the process is quick. |
| "Emergency, no time for the process" | Systematic debugging is faster than repeated guess-and-fix. |
| "Try it first, investigate later" | The first fix sets the tone. Do it right from the start. |
| "Write the test after confirming the fix works" | A fix without a test won't stick. Write the test first to prove the fix works. |
| "Fix multiple problems at once to save time" | You can't isolate which one worked. It also introduces new bugs. |
| "I see the problem, let me fix it" | Seeing the symptom ≠ understanding the root cause. |
| "One more try" (after 2+ failures) | 3+ failures = an architecture problem. Question the pattern, don't keep fixing. |

## Quick reference

| Phase | Key activities | Pass criteria |
|------|---------|---------|
| **1. Root cause** | Read errors, reproduce, check changes, gather evidence | Understood what went wrong and why |
| **2. Pattern** | Find a working example, compare | Differences identified |
| **3. Hypothesis** | State a theory, verify minimally | Hypothesis confirmed or a new one produced |
| **4. Implementation** | Create test, fix, verify | Bug fixed, tests pass |

## Real-world effect

Data from debugging practice:
- Systematic approach: 15-30 minutes to fix
- Random-fix approach: 2-3 hours of back-and-forth
- First-fix success rate: 95% vs 40%
- New bugs introduced: nearly zero vs frequent

## BaJie-MCP integration notes

This skill is used by the BaJie-MCP control center when dispatching tasks. When the control center dispatches a bug-fix task to the bug_fix role, it attaches a `[SKILL: systematic-debugging]` hint.
