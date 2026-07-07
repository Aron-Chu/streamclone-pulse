---
name: brainstorming
description: "Must be used before any creative work — creating a feature, building a component, adding functionality, or changing behavior. Explore the user's intent, requirements, and design before implementing."
---

# Brainstorming: Turning Ideas into Designs

Through natural, collaborative conversation, help turn an idea into a complete design and specification.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what is to be built, present the design and get the user's approval.

## Anti-pattern: "This is too simple to need a design"

Every project goes through this process. A to-do list, a single-function tool, a config change — all of them. "Simple" projects are exactly where untested assumptions cause the most waste. The design can be very short (a few sentences for a truly simple project), but you must present it and get approval.

## Checklist

You must create a task for each item below and complete them in order:

1. **Explore project context** — examine files, docs, recent commits
2. **Provide a visual companion** (if the topic involves visual matters) — this is a separate message; do not merge it with the clarifying questions. See the "Visual companion" section below.
3. **Ask clarifying questions** — one at a time, to understand purpose / constraints / success criteria
4. **Propose 2-3 approaches** — with trade-off analysis and your recommendation
5. **Present the design** — section by section, ordered by complexity, getting user approval after each section
6. **Write the design doc** — save to `docs/superpowers/specs/YYYY-MM-DD-<name>-design.md` and commit
7. **Spec self-check** — a quick inline check for placeholders, contradictions, ambiguity, and scope (see below)
8. **User reviews the written spec** — ask the user to review the spec file before continuing
9. **Transition to implementation** — invoke the writing-plans skill to create an implementation plan

## Process in detail

**Understand the idea:**

- First review the current project state (files, docs, recent commits)
- Before asking detailed questions, assess scope: if the requirement describes multiple independent subsystems (e.g. "build a platform with chat, file storage, billing, and analytics"), point that out immediately. Don't spend time refining a project with questions when it needs to be split first.
- If the project is too large for a single spec to cover, help the user break it into subprojects: what are the independent parts, how do they relate, and in what order should they be built? Then brainstorm the first subproject through the normal design process. Each subproject has its own spec → plan → implementation cycle.
- For an appropriately scoped project, ask one question at a time to refine the idea
- Prefer multiple-choice questions; open-ended questions are fine too
- One question per message — if a topic needs more exploration, split it into multiple questions
- Focus on understanding: purpose, constraints, success criteria

**Explore approaches:**

- Propose 2-3 different approaches with their trade-offs
- Present the options conversationally, with your recommendation and reasoning
- Show your recommended approach first and explain why

**Present the design:**

- Once you think you understand what is to be built, present the design
- Make each section's length match its complexity: a few sentences for simple ones, at most 200-300 words for complex ones
- After each section, ask whether it's correct
- Cover: architecture, components, data flow, error handling, testing
- Be ready to go back and clarify anything unclear

**Design for isolation and clarity:**

- Break the system into smaller units, each with a single clear responsibility, communicating through well-defined interfaces, that can be understood and tested independently
- For each unit, you should be able to answer: what does it do, how is it used, what does it depend on?
- Can someone understand what a unit does without reading its internals? Can you change the internals without affecting callers? If not, the boundaries need adjusting.
- Smaller units with clear boundaries are also easier for you to work with — you reason better about code that fits into context at once, and your edits are more reliable the more focused a file is. When a file grows large, it usually means it has taken on too many responsibilities.

**Working in an existing codebase:**

- Explore the existing structure before proposing changes. Follow existing patterns.
- If existing code has problems that affect the current work (e.g. files too large, unclear boundaries, tangled responsibilities), include targeted improvements in the design — just as a good developer improves the code they touch along the way.
- Don't propose unrelated refactors. Focus on what serves the current goal.

## After the design

**Documentation:**

- Write the validated design (the spec) to `docs/superpowers/specs/YYYY-MM-DD-<name>-design.md`
 - (the user's preference for spec location takes precedence over this default)
- Commit the design doc to git

**Spec self-check:**
After writing the spec doc, review it with fresh eyes:

1. **Placeholder scan:** Are there any "TBD", "TODO", unfinished sections, or vague requirements? Fix them.
2. **Internal consistency:** Are there contradictions between sections? Do the architecture and feature descriptions match?
3. **Scope check:** Is this focused enough to be covered by one implementation plan, or does it need further splitting?
4. **Ambiguity check:** Can any requirement be understood two ways? If so, pick one and write it out explicitly.

If you find a problem, fix it inline. No need to re-review — fix it and move on.

**User review gate:**
After the spec self-check, ask the user to review the written spec before continuing. Wait for the user's reply. If they request changes, make them and re-run the spec self-check. Only continue after the user approves.

**Implementation:**

- Invoke the writing-plans skill to create a detailed implementation plan
- Do not invoke any other skill. writing-plans is the next step.

## Core principles

- **One question at a time** — don't throw multiple questions out at once
- **Prefer multiple choice** — easier to answer than open-ended questions where possible
- **Follow YAGNI strictly** — remove unnecessary features from every design
- **Explore alternatives** — always propose 2-3 approaches before deciding
- **Incremental validation** — present the design, get approval, then continue
- **Stay flexible** — go back and clarify whenever something is unclear

## BaJie-MCP integration notes

This skill is used by the BaJie-MCP control center when dispatching tasks. When the control center dispatches a requirements-analysis task to product_mgr / fullstack_dev, it attaches a `[SKILL: brainstorming]` hint, and the receiver should follow this skill's process.
