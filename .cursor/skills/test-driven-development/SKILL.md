---
name: test-driven-development
description: Use when implementing any feature or fixing a bug, before writing implementation code
---

# Test-Driven Development (TDD)

## Overview

Write the test first. Watch it fail. Write the minimal code to make it pass.

**Core principle:** If you haven't seen the test fail, you don't know whether it tests the right thing.

**Violating the letter of the rule is violating the spirit of the rule.**

## When to use

**Always use:**
- New features
- Bug fixes
- Refactoring
- Behavior changes

**Exceptions (ask your human partner):**
- One-off prototypes
- Generated code
- Config files

Thinking "just skip TDD this once"? Stop. That's you making an excuse.

## Iron rule

```
No production code without a failing test
```

Wrote the code before the test? Delete it. Start over.

**No exceptions:**
- Don't keep it as a "reference"
- Don't "adapt" it while writing the test
- Don't look at it
- Delete means delete

Start from the test and reimplement. Period.

## Red-Green-Refactor

### Red - write a failing test

Write a minimal test that demonstrates the expected behavior.

**Requirements:**
- One behavior
- A clear name
- Use real code (only mock when there's no other choice)

### Verify red - watch it fail

**Must do. Never skip.**

```bash
npm test path/to/test.test.ts
```

Confirm:
- The test fails (not errors)
- The failure message is as expected
- The cause of failure is the missing feature (not a typo)

**Test passed?** You're testing existing behavior. Change the test.

**Test errored?** Fix the error and rerun until it fails correctly.

### Green - minimal code

Write the simplest code to make the test pass. Don't add features, refactor other code, or make "improvements" beyond what the test requires.

### Verify green - watch it pass

**Must do.**

Confirm:
- The test passes
- Other tests still pass
- The output is clean (no errors, no warnings)

**Test failed?** Change the code, not the test.

**Other tests failed?** Fix them immediately.

### Refactor - clean up the code

Only refactor after green:
- Eliminate duplication
- Improve naming
- Extract helper functions

Keep the tests green. Don't add behavior.

### Repeat

Write the next failing test for the next feature.

## Good tests

| Trait | Good | Bad |
|------|------|------|
| **Minimal** | Tests one thing only. An "and" in the name? Split it. | `test('validates email and domain and whitespace')` |
| **Clear** | The name describes the behavior | `test('test1')` |
| **Shows intent** | Shows the expected API | Obscures what the code should do |

## Why order matters

**"I'll finish writing it first, then add tests to verify"**

Tests written afterward pass immediately. Passing immediately proves nothing:
- May test the wrong thing
- May test the implementation rather than the behavior
- May miss the edge case you forgot
- You never saw it catch a bug

Writing the test first forces you to see the test fail, proving it actually tests something.

## Common excuses

| Excuse | Reality |
|------|------|
| "Too simple to test" | Simple code has bugs too. A test takes only 30 seconds. |
| "I'll add tests later" | A test that passes immediately proves nothing. |
| "Tests added later achieve the same thing" | Tests added later = "what does this do?" Test first = "what should this do?" |
| "I already tested it manually" | Ad-hoc testing ≠ systematic testing. No record, not reproducible. |
| "Deleting X hours of work is wasteful" | Sunk-cost fallacy. Keeping unverified code is tech debt. |
| "TDD slows me down" | TDD is faster than debugging. Pragmatic = test first. |
| "The existing code has no tests" | You're improving it. Add tests for the existing code. |

## Red flags - stop, start over

- Wrote the code before the test
- Added the test only after implementing
- The test passes immediately
- Can't explain why the test fails
- "Add it later" tests
- Talking yourself into "just this once"
- "I already tested it manually"
- "This case is different because…"

**All of the above mean: delete the code. Start over with TDD.**

## Example: bug fix

**Bug:** an empty email was accepted

**Red**
```typescript
test('rejects empty email', async () => {
  const result = await submitForm({ email: '' });
  expect(result.error).toBe('Email required');
});
```

**Verify red**
```bash
$ npm test
FAIL: expected 'Email required', got undefined
```

**Green**
```typescript
function submitForm(data: FormData) {
  if (!data.email?.trim()) {
    return { error: 'Email required' };
  }
  // ...
}
```

**Verify green**
```bash
$ npm test
PASS
```

## Verification checklist

Before marking work complete:

- [ ] Every new function/method has a test
- [ ] Saw each test fail before implementing
- [ ] Each test fails for the expected reason (missing feature, not a typo)
- [ ] Wrote the minimal code to make each test pass
- [ ] All tests pass
- [ ] Output is clean (no errors, no warnings)
- [ ] Tests use real code (mock only when unavoidable)
- [ ] Edge cases and error scenarios are covered

Can't check all the boxes? You skipped TDD. Start over.

## When stuck

| Problem | Solution |
|------|----------|
| Don't know how to test | Write the API you expect. Write the assertion first. Ask your human partner. |
| Test too complex | The design is too complex. Simplify the interface. |
| Have to mock everything | The code is too tightly coupled. Use dependency injection. |
| Test setup too large | Extract helper functions. Still complex? Simplify the design. |

## Debugging integration

Found a bug? Write a failing test that reproduces it. Follow the TDD cycle. The test both proves the fix works and prevents regression.

Never fix a bug without a test.

## Final rule

```
Production code → a test exists and failed first
Otherwise → it's not TDD
```

No exceptions without your human partner's permission.

## BaJie-MCP integration notes

This skill is used by the BaJie-MCP control center when dispatching tasks. When the control center dispatches a feature-development task to feature_dev / backend_dev / frontend_dev, it attaches a `[SKILL: test-driven-development]` hint.
