---
name: verification-before-completion
description: Use before claiming work is done, fixed, or that tests pass, and before committing or creating a PR — you must run the verification command and confirm its output before claiming success; always back assertions with evidence
---

# Verification Before Completion

## Overview

Claiming work is done without verification isn't efficiency, it's dishonesty.

**Core principle:** Always back conclusions with evidence.

**Going through the motions on this rule is betraying its spirit.**

## Iron rule

```
No completion claim without fresh verification evidence
```

If you didn't run a verification command in this message, you can't claim the tests pass.

## Gating function

```
Before claiming any status or expressing satisfaction:

1. Determine: what command would prove this conclusion?
2. Run: execute the full command (rerun, in full)
3. Read: the full output, check the exit code, count the failures
4. Verify: does the output support this conclusion?
   - If no: state the actual status, with evidence
   - If yes: state the conclusion, with evidence
5. Only then: draw the conclusion

Skipping any step = lying, not verifying
```

## Common failure modes

| Conclusion | Requires | Not good enough |
|------|------|--------|
| Tests pass | Test command output: 0 failures | A previous run, "should pass" |
| Linter clean | Linter output: 0 errors | A partial check, inference |
| Build succeeds | Build command: exit 0 | Linter passed, logs look fine |
| Bug fixed | Test the original symptom: passes | Code changed, assumed fixed |
| Portal / analytics UI change | `npm run test:e2e` (or targeted `tests/e2e/analytics-*.spec.ts`) + `assertNoWhiteAnalyticsSurfaces` | Unit tests only; no layout/theme check |
| Regression test works | Red-green cycle verified | Test only passed once |
| Agent done | VCS diff shows the change | Agent reported "success" |
| Requirements met | Item-by-item checklist | Tests pass |

## Red lines — stop

- Using "should", "probably", "seems"
- Expressing satisfaction before verifying ("Great!", "Perfect!", "Done!", etc.)
- About to commit/push/create a PR without verifying
- Trusting an agent's success report
- Relying on partial verification
- Thinking "just this once"
- Tired and wanting to wrap up
- **Any wording that implies success without actually running verification**

## Preventing rationalization

| Excuse | Reality |
|------|------|
| "It should work now" | Run the verification command |
| "I'm confident" | Confidence ≠ evidence |
| "Just this once" | No exceptions |
| "The linter passed" | Linter ≠ compiler |
| "The agent said it succeeded" | Verify independently |
| "I'm tired" | Fatigue ≠ an excuse |
| "A partial check is enough" | A partial check proves nothing |
| "Reword it and this rule doesn't apply" | Spirit over letter |

## Key patterns

**Tests:**
```
✅ [run the test command] [see: 34/34 pass] "all tests pass"
❌ "should pass now" / "looks right"
```

**Regression tests (TDD red-green):**
```
✅ write → run (pass) → revert the fix → run (must fail) → restore → run (pass)
❌ "I wrote a regression test" (without red-green verification)
```

**Build:**
```
✅ [run the build] [see: exit 0] "build passes"
❌ "the linter passed" (the linter doesn't check compilation)
```

**Requirements:**
```
✅ reread the plan → create a checklist → verify item by item → report gaps or completion
❌ "tests pass, phase complete"
```

**Agent delegation:**
```
✅ agent reports success → check the VCS diff → verify the changes → report the actual status
❌ trust the agent's report
```

## Why this matters

- Your partner says "I don't trust you" — trust is broken
- An undefined function gets shipped — it crashes outright
- A missed requirement gets shipped — the feature is incomplete
- Time wasted on false completion → rework → redo

## When to use

**Required before:**
- Any kind of success/completion claim
- Any expression of satisfaction
- Any positive statement about the state of the work
- Committing, creating a PR, marking a task done
- Moving to the next task
- Delegating to an agent

## Portal UI (StreamPulse / analytics hub)

When changing `streampulse-web` analytics layout, colors, themes, or hub UX:

1. Run unit tests: `npm test` in `streampulse-web`
2. Run Playwright: `npm run test:e2e -- tests/e2e/analytics-hub-ux.spec.ts tests/e2e/hub-audit-regression.spec.ts tests/e2e/analytics-figma-parity.spec.ts`
3. On intentional visual changes, update snapshots with `npx playwright test --update-snapshots` for the affected spec only
4. Helpers `assertNoWhiteAnalyticsSurfaces` and hub audit contrast checks catch theme regressions

## Chrome extension (`streamclone-pulse` `src/`)

After editing extension overlay, content script, popup, or options:

1. `npm test` in `streamclone-pulse` when logic/tests exist for the change
2. **`npm run build`** — required; Chrome loads `dist/`, not `src/`
3. Tell the user to reload at `chrome://extensions` and hard-refresh Twitch

Claiming "fixed in extension" without a fresh `npm run build` is a stale-bundle false negative.

## Bottom line

**There's no shortcut to verification.**

Run the command. Read the output. Only then claim the result.

This is non-negotiable.

## BaJie-MCP integration notes

This skill is used by all BaJie-MCP execution roles before reporting results via `send_to_session(messageType:"result")`. When the control center aggregates results, it checks whether verification evidence is attached.
