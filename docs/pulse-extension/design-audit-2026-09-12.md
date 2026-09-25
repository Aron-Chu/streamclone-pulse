# Extension design audit — 2026-09-12

Scope: the three extension surfaces — Twitch overlay (content), toolbar popup,
and the full-page settings workspace. Portal and Supporter/billing excluded.

Measured against [`ui-design-guide.md`](./ui-design-guide.md). The guide was
already concrete; the gap was **conformance**, plus two places where the guide
itself had fallen behind the implementation. This is a dated audit record, not a
replacement for the guide.

Captures: `test-results/design-audit/` via
[`design-accent-sweep.mocked.spec.ts`](../../tests/e2e/specs/design-accent-sweep.mocked.spec.ts).

---

## 1. Findings and disposition

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | `--pulse-accent-light` referenced but **defined nowhere**, so focus rings and hover borders on both settings surfaces stayed Aurora purple under Volt, Azure and Emerald | High (a11y: focus indicator) | **Fixed** |
| 2 | Accent, density and placement pickers implemented **twice** with divergent markup, classes and copy — the same placement value read "Right" in the overlay and "Right dock" on the page | High (this is the "off-theme" feeling) | **Fixed** |
| 3 | `emerald` shipped as a selectable 4th accent, absent from the guide and with **no WCAG contrast row** | High (undocumented a11y) | **Fixed** |
| 4 | Full-page settings typeset entirely at **9–11px** — overlay density applied to a full-width page. 26 declarations | High (legibility) | **Fixed** |
| 5 | `fontSize: 8`/`8.5` in 9 places, below every floor, incl. game-card names at weight 850 over a gradient | High (legibility) | **Fixed** |
| 6 | Swatch hexes hardcoded in `ACCENT_THEME_OPTIONS`, duplicating `ACCENT_PALETTES` and free to drift | Medium | **Fixed** |
| 7 | Option copy in nested ternaries; a 5th accent would silently render "Cool blue" | Medium | **Fixed** |
| 8 | `.pulse-settings-error-banner` styled by a 13-property inline object using `rgba(239,68,68)` — a different red from `theme.error` — against a class that **existed in no stylesheet** | Medium | **Fixed** |
| 9 | Test harness `ExtensionStorageSeed.themePreference` typed `'aurora' \| 'volt' \| 'azure'`, so emerald was untestable | Medium | **Fixed** |
| 10 | `design-audit-final.mocked.spec.ts` wrote screenshots to an absolute path inside one agent session's scratch directory | Low | **Fixed** |

### Corrected during the audit — not defects

Claims worth recording because they were plausible and wrong:

- **`theme.ts` does handle reduced motion.** Three `prefers-reduced-motion:
  reduce` blocks (89, 454, 1181), plus real infrastructure in `src/ui/motion/`
  (`useReducedMotion`, `useChartExpansion`, `useSmoothedScalar`). Not a gap.
- **`hostStyles.ts` was not bypassing tokens.** Its `#c4b5fd`-style values are
  `var(--pulse-*, <fallback>)` fallbacks, which is the documented pattern. An
  initial count of "hardcoded hexes" was an overcount.
- **`--pulse-ease-out`, `--pulse-motion-fast`, `--pulse-host-bar-h`** are
  defined in CSS (`theme.ts:1145-1149`, `hostStyles.ts:44`), not missing.
- **Settings IA is sound**: `SectionIntro` → `PulseSectionCard` → `ToggleRow`,
  with a skip link, `aria-current` and reduced-motion-aware scrolling in
  `SettingsHostShell`.
- **The 724-line page-only stylesheet is deliberate** and correctly justified in
  its own header comment; it is kept out of the content script on purpose.

---

## 2. What changed

**One picker, two densities.** New [`src/ui/ChoicePicker.tsx`](../../src/ui/ChoicePicker.tsx)
renders accent, density and placement for both surfaces, selecting the existing
compact (Twitch rail) or detailed (full page) class families by `variant`. No new
CSS. Option lists consolidated into
[`src/ui/preferenceOptions.ts`](../../src/ui/preferenceOptions.ts) and
`ACCENT_THEME_OPTIONS`, whose swatches are now derived from
`ACCENT_PALETTES[value].accent`.

**Descriptions are page-only.** They live in
[`src/options/preferenceDescriptions.ts`](../../src/options/preferenceDescriptions.ts)
because the compact pickers never render them, and the content script has the
least bundle headroom. Verified absent from `dist/content/twitch.js`.

**`accentLight` added to all four palettes**, each verified to match its existing
`accentLightRgb` channels exactly, and wired into `VAR_NAMES`.

**Page type scale.** Caps 12 / body 13 / emphasis 14, replacing 9/10/11. One
role error from the mechanical pass was corrected by hand: the uppercase brand
subtitle had landed on the body step, matching the title above it.

**8px eliminated** — 9 declarations raised to the 9px overlay floor.

---

## 3. Guide amendments

- §4 — Emerald added with `accentLight` column; contrast rows computed and
  cross-checked by reproducing the three existing rows exactly (5.11, 7.53, 5.70)
  before trusting the new ones. Emerald strong on dark ink **7.18:1 (AAA)**,
  accent on dark ink **9.47:1 (AAA)**, and white on Emerald strong **2.54:1 —
  prohibited**, like Volt.
- §7 — per-surface floors stated with reasons: overlay 9px (caps and axis labels
  only, ~320px rail), popup 11px, full page and portal 12px. **8px permitted
  nowhere.**
- §20 — two patterns added: the same control implemented twice with divergent
  markup, and inline `style` for values a token or stylesheet already owns.

---

## 4. Verification

| Gate | Result |
|------|--------|
| `npm test` | **1196 pass / 160 files** (was 1189 / 158) |
| `npm run typecheck` | clean |
| `npm run build` | clean |
| `npm run check:bundle-budget` | ok — gzip 167691 / 168300 |
| `design-accent-sweep` + `design-audit-final` + `supporter-settings` | **18 pass** |

New guards: [`tests/accentThemeVariables.test.ts`](../../tests/accentThemeVariables.test.ts)
(every referenced `--pulse-*` resolves; swatches derive from palettes; every
selectable accent appears in the guide) and
[`tests/typographyFloor.test.ts`](../../tests/typographyFloor.test.ts)
(per-surface floors).

Both were confirmed **non-vacuous** by reverting the fix and observing failure.
That mattered: the first version of the floor test enumerated files via
`git ls-files` with a quoted pathspec, which under `execSync` on Windows runs
through cmd.exe where the quotes are literal — it scanned **zero files and
passed**. `tests/helpers/sourceFiles.ts` now walks the filesystem instead, and
also covers untracked files, which `git ls-files` had excluded — `hostStyles.ts`
itself is untracked, so all 26 page violations were invisible.

### Open — bundle cost

Content gzip moved **167533 → 167691 (+158 bytes)**; headroom 767 → 609. The
shared component is net-negative on the page bundle but net-positive on the
content bundle, because the duplication spanned both and only one is the
constraint. Recorded as a finding rather than absorbed silently. The chat-badge
pipeline needs real code-splitting regardless; 609 bytes does not change that.

### Not addressed — needs design approval

New motion design, chart restyling, settings IA changes, and light mode. Guide
§12 warns against forking a second animation system, so motion waits. Popup
surface was reviewed for tokens and floors but not visually redesigned.

Screenshots in `test-results/design-audit/` show the **fixed** state across all
four accents; there is no before/after pair, because the fixes landed before the
capture matrix existed.
