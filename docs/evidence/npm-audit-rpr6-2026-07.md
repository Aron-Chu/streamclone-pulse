# npm audit disposition — RPR-6 / public security closeout (2026-07)

At the original disposition, portal (`streampulse-web`) and root workspace
audits reported **two high** findings that resolved to the same advisory.
No build-only exception is active. The October 2 braces and November 18
picomatch dispositions are kept as history; both advisories were withdrawn.

| Package | Severity | Advisory |
|---------|----------|----------|
| `react-router` | high | [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2) — RSC Mode CSRF bypass before 400 response |
| `react-router-dom` | high | Same (depends on `react-router`) |

**Installed range at disposition:** `react-router-dom@7.18.2` / `react-router@7.18.2`
(advisory range `>=7.12.0 <8.3.0`; fix published as `react-router@8.3.0`).

## Disposition: `vulnerable_code_not_used`

1. **Exploit surface:** The advisory is scoped to **React Router RSC Mode**.
   StreamPulse portal is a **classic Vite + React 18 SPA** (`streampulse-web`) with
   client-side `react-router-dom` only. It does **not** enable React Server
   Components, RSC-mode router actions, or React 19 server runtimes.
2. **Evidence scan:** No portal source matches RSC entry points
   (`react-server`, `createFromReadableStream`, `ServerRouter`, etc.).
3. **Why not bumped now:** Moving to `react-router@8.3.0` is a **major** line
   change and would force a React Router 8 / ecosystem jump. Per program rules:
   do **not** force React Router 8, React 19, or Node 22-only upgrades solely to
   clear this alert.
4. **CI enforcement:** `scripts/ci-portal-npm-audit-disposition.mjs` is applied
    to both the root lock and `streampulse-web/package-lock.json`. It requires a
    valid npm v2 vulnerability schema, matching severity metadata, and the exact
    Router advisory metadata. The exception covers only these two
    package names.
    Any unreviewed high/critical finding or audit command/report error fails CI.
5. **GitHub Dependabot:** alerts dismissed as `vulnerable_code_not_used` with
   this evidence (public security closeout).

## Related fix (2026-08-08): `nanoid` pin (not dispositioned)

`npm audit` also reported **high** [`GHSA-2v37-7h3g-55p8`](https://github.com/advisories/GHSA-2v37-7h3g-55p8)
(`nanoid` custom generators can loop when size is zero; range `<3.3.17`).
This is a transitive PostCSS/Vite build dependency. Patched releases exist on
the 3.3 line (`3.3.17` / `3.3.18`), so both root and `streampulse-web` pin
`nanoid` to **`3.3.18`** via `overrides` rather than adding a disposition
exception. Re-run `npm audit` after lock refresh; do not list nanoid in
`DISPOSITIONED_HIGHS` unless a future advisory lacks a trivial pin.

## Build-only disposition (2026-10-02): unpatched `braces` stack exhaustion

**Retired 2026-11-18.** GitHub withdrew this advisory on 2026-10-23 and npm
no longer reports it. Its five-node graph was removed from the gate; the same
Tailwind packages are no longer covered by any exception.

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
was reviewed/updated on October 2 and caused the automatic post-merge portal
audit to fail. It affects `braces <=3.0.3`: deeply nested brace patterns can
exhaust the Node.js stack. The advisory lists **no patched release**; the
official npm registry still reports `braces@3.0.3` as latest. The existing
Tailwind 3 dependency graph therefore has five high package entries for this
single advisory:

| Locked development dependency | Exact audit `via` |
|---|---|
| `braces@3.0.3` | Exact GHSA metadata (npm source `1240992`, range `<=3.0.3`) |
| `chokidar@3.6.0` | `braces` |
| `micromatch@4.0.8` | `braces` |
| `fast-glob@3.3.3` | `micromatch` |
| `tailwindcss@3.4.19` | `chokidar`, `fast-glob`, `micromatch` |

**Disposition: no attacker-controlled production reachability.** The build
does execute these glob tools; this is not a claim that vulnerable code never
runs. The two Tailwind configurations use shallow repository-controlled
source globs. Their Node/PostCSS execution generates static CSS from the
reviewed checkout and receives no customer, account, payment, or fetched
analytics patterns. Every affected lock node is explicitly `dev: true`.

The portal publishes Vite browser chunks, compiled CSS, and static assets.
The existing build plugin now refuses any affected module in **any emitted
browser chunk**, including lazy routes. The copied Pages `_worker.js` was
separately inspected: it has no imports and only relays approved routes; it
does not include Node dependency packages. Source maps and the emitted build
were inspected locally to confirm the affected packages are absent.

The audit exception is limited to the `streampulse-web` lock identity and
requires this complete five-node graph, locked versions, development flags,
and advisory metadata. It does not exempt a new root/extension occurrence.
Additional same-package advisories,
unknown/changed parents, missing/extra nodes, cycles, critical severity, or
new versions fail. Existing root and portal audit steps run adversarial policy
self-tests. The Router exception and audit schema/error checks remain intact.

Build-time denial of service remains possible if someone intentionally changes
the reviewed source/configuration to feed deeply nested patterns. Treat such
source changes as untrusted during review. Remove this disposition when a
compatible patched package is published. npm currently suggests Tailwind 4
as remediation; its dual-config/CSS compatibility migration needs separate
product validation, rather than an untested major change to clear this gate.

## Patched development tools (2026-10-05)

Root and portal overrides pin `source-map-js@1.2.2` for
[GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) and
`tinypool@2.1.2` for [GHSA-5gmw-xhrv-c9v3](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3)
and [GHSA-85c8-ppgw-ccpr](https://github.com/advisories/GHSA-85c8-ppgw-ccpr).
These pins remove the new high/critical findings without audit exceptions.
Tinypool 2 requires Node 20 or 22+, matching the existing Node 22 CI; its
override is outside Vitest 3's declared range, so both complete test suites
and production builds must pass before merge. Vitest remains at 3.2.7.
The portal also pins `postcss-selector-parser@7.1.6` for
[GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf),
which otherwise adds unexpected advisory paths to the exact Tailwind graph.
The existing five-node braces disposition remains unchanged.

## Build-only disposition (2026-11-18): `picomatch` ReDoS — retired 2026-11-22

**Retired 2026-11-22. No exception is active.** GitHub withdrew
[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
(npm source `1247710`, high, range `<=4.0.7`) on 2026-11-18 as "not a security
issue", and picomatch's maintainer said the same: globs are regular expressions,
so do not pass untrusted patterns. npm no longer reports it. On 2026-11-22
`npm audit` on both locks showed no high or critical finding. The exception was
merged the same day as the withdrawal and was set to expire 2026-12-02; once the
advisory left the audit it excused nothing, and the expiry would not have turned
CI red. No patched picomatch exists (4.0.7 is latest) and none is needed. Its
exact graphs, expiry and the portal fixture were removed.

**If it comes back.** A re-published advisory is no longer excused: the gate fails
closed for every package it reaches. The selftest checks this against
`scripts/fixtures/npm-audit-picomatch-republished.json`, a real root audit
from while the advisory was live. Re-review reachability below before adding any
new exception, and give it an expiry.

**Dependency path (both locks).** picomatch is pulled in only by development
tools; every lock node is `dev: true`. It cannot be dropped without dropping
Vite, Vitest or Tailwind 3, and no override helps while no patched release exists.

| Lock | picomatch | Pulled in by |
|---|---|---|
| root | `4.0.5` | `vite` (build), `tinyglobby` and `fdir` under it, `vitest` and its `vite` 7 copies |
| portal | `2.3.2` | `tailwindcss` 3 through `micromatch`, `chokidar`, `anymatch`, `readdirp` |
| portal | `4.0.5` (4 nested copies) | `vite`, `tinyglobby`, `vitest`, `vite-node` |

**Reachability (measured 2026-11-22 on master `aed30001`).** Every copy of
picomatch's `parse` and `scan` was logged while running the full root build and
test suite and the full portal build and test suite. Result: 300 calls and 62
distinct patterns, all written by this repository's configs or by the tools'
own defaults (Vite ignore and watch lists, Vitest include and exclude lists,
Tailwind `content` paths, dependency names). No request, account, payment or
analytics input reaches picomatch. Correction to the 2026-11-18 text: the
configs have no extglobs, but Vitest's built-in default test filter does
(`**/*.{test,spec}.?(c|m)[jt]s?(x)`). It is a fixed string with optional
groups, not the repeated `+(` or `*(` form the advisory named, and nothing
here can change it.

**Browser output.** The portal build passed the guard below, and a text search
of the root `dist/` (23 files) and portal `dist/` (251 files) found no
picomatch, tinyglobby or micromatch code.

**The guard stays.** `assertBuildOnlyAuditRuntimeBoundary` in the gate script,
called by `streampulse-web/vite.config.ts`, still refuses any module of these
build tools in any emitted browser chunk, lazy routes included. Its package list
is unchanged by this retirement. The extension build has no such plugin; the
search above is its only check.

## Owner follow-up (optional, separate program)

- Schedule a dedicated React Router major upgrade when product-ready, then
  re-run `npm audit` until highs are zero or newly dispositioned with evidence.
  Do not use `npm audit fix --force` as a release disposition; the current
  Router exception remains limited to the documented RSC-only case.
