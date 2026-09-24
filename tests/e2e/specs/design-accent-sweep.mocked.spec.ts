import { test, expect } from '../helpers/testFixtures.ts'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Capture matrix for the design audit.
 *
 * Every selectable accent is rendered on both settings surfaces and checked for
 * Aurora residue. `--pulse-accent-light` was previously referenced but never
 * defined, so focus rings and hover borders stayed purple on Volt, Azure and
 * Emerald — a mistake no single-accent screenshot would reveal.
 *
 * Artifacts land under the repo's own test-results directory. Do not point this
 * at an absolute path outside the repo.
 */
const CAPTURE_DIR = join('test-results', 'design-audit')
const ACCENTS = ['aurora', 'volt', 'emerald', 'azure'] as const
const AURORA_RESIDUE = ['#a78bfa', '#8b5cf6', '#7c3aed', '#c4b5fd', '#ddd6fe']

/** Accent hexes that must appear for a given accent, as rgb() strings. */
const EXPECTED_ACCENT: Record<(typeof ACCENTS)[number], string> = {
  aurora: 'rgb(139, 92, 246)',
  volt: 'rgb(249, 115, 22)',
  emerald: 'rgb(52, 211, 153)',
  azure: 'rgb(34, 211, 238)',
}

test.describe('accent sweep across settings surfaces', () => {
  for (const accent of ACCENTS) {
    test(`full-page settings renders ${accent} with no Aurora residue`, async ({ extension, prepare }) => {
      mkdirSync(CAPTURE_DIR, { recursive: true })
      await prepare({ scenario: 'live-ready', storage: { themePreference: accent } })
      const page = extension.page
      await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#pulse`)
      await expect(page.locator('[data-settings-workspace="true"]')).toBeVisible()

      // The runtime must actually write every accent variable, including the one
      // that was missing. An empty value here means a silent Aurora fallback.
      const vars = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement)
        return {
          accent: style.getPropertyValue('--pulse-accent').trim(),
          accentLight: style.getPropertyValue('--pulse-accent-light').trim(),
          attr: document.documentElement.getAttribute('data-pulse-accent'),
        }
      })
      expect(vars.attr).toBe(accent)
      expect(vars.accent, 'accent variable unset').not.toBe('')
      expect(vars.accentLight, '--pulse-accent-light is unset, so focus rings fall back to Aurora').not.toBe('')

      // Each option shows its own colour, so assert the *selected* card's
      // swatch rather than the first one in the grid.
      const activeSwatch = page
        .getByRole('group', { name: 'Accent theme' })
        .locator('.pulse-settings-choice-card-active .pulse-settings-choice-swatch')
      await expect(activeSwatch).toHaveCSS('background-color', EXPECTED_ACCENT[accent])

      // Focus ring colour must follow the accent, not the Aurora fallback.
      const navLink = page.locator('.pulse-host-nav a').first()
      await navLink.focus()
      const outline = await navLink.evaluate(element => getComputedStyle(element).outlineColor)
      if (accent !== 'aurora') {
        expect(outline, `focus outline stayed Aurora under ${accent}`).not.toBe('rgb(167, 139, 250)')
      }

      await page.screenshot({
        path: join(CAPTURE_DIR, `options-pulse-${accent}.png`),
        animations: 'disabled',
        fullPage: true,
      })
    })
  }

  test('accent variables resolve for every accent without Aurora leakage', async ({ extension, prepare }) => {
    await prepare({ scenario: 'live-ready' })
    const page = extension.page
    await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#pulse`)

    for (const accent of ACCENTS) {
      await page.evaluate(value => {
        document.querySelectorAll<HTMLButtonElement>('.pulse-settings-choice-card').forEach(button => {
          if (button.textContent?.toLowerCase().startsWith(value)) button.click()
        })
      }, accent)
      await expect(page.locator('html')).toHaveAttribute('data-pulse-accent', accent)

      const resolved = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement)
        return ['--pulse-accent', '--pulse-accent-strong', '--pulse-accent-light', '--pulse-accent-soft', '--pulse-accent-ink']
          .map(name => style.getPropertyValue(name).trim().toLowerCase())
      })
      expect(resolved.every(value => value !== ''), `${accent} left a variable unset`).toBe(true)
      if (accent !== 'aurora') {
        for (const value of resolved) {
          expect(AURORA_RESIDUE, `${accent} resolved an Aurora value: ${value}`).not.toContain(value)
        }
      }
    }
  })

  test('settings surfaces agree on option labels', async ({ extension, prepare }) => {
    await prepare({ scenario: 'live-ready' })
    const page = extension.page
    await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#pulse`)
    // Both surfaces now read one option list, so the page must show the shared
    // placement labels rather than its own former wording.
    for (const label of ['Sidebar', 'Right dock', 'Bottom dock']) {
      await expect(page.getByRole('group', { name: 'Overlay placement' }).getByText(label, { exact: true })).toBeVisible()
    }
    for (const accent of ['Aurora', 'Volt', 'Emerald', 'Azure']) {
      await expect(page.getByRole('group', { name: 'Accent theme' }).getByText(accent, { exact: true })).toBeVisible()
    }
  })
})
