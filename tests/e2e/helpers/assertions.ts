import fs from 'node:fs'
import { expect, type Page } from '@playwright/test'
import { EXTENSION_MANIFEST_PATH } from './extensionContext.ts'
import type { EvidenceCollectors } from './evidence.ts'

export const PULSE_ROOT_ID = 'streamclone-pulse-root'
export const PULSE_TABS_ID = 'streamclone-pulse-tabs'

/** Permissions intentionally allowed in the production manifest. */
export const EXPECTED_MANIFEST_PERMISSIONS = ['storage', 'scripting'] as const

/**
 * Required host permissions for the production / CWS package.
 * Localhost BFF hosts are optional_host_permissions (dev opt-in only).
 */
export const EXPECTED_HOST_PERMISSIONS = [
  'https://api.streampulse.stream/*',
  'https://cdn.7tv.app/*',
  'https://static-cdn.jtvnw.net/*',
  'https://cdn.frankerfacez.com/*',
  'https://gql.twitch.tv/*',
  'https://*.twitch.tv/*',
] as const

export const EXPECTED_OPTIONAL_HOST_PERMISSIONS = [
  'http://localhost:8081/*',
  'http://127.0.0.1:8081/*',
] as const

const FORBIDDEN_HOST_SUBSTRINGS = [':8090', ':9876', 'localhost:3000', '127.0.0.1:3000']

export async function waitForPulseRoot(page: Page, timeoutMs = 20_000): Promise<void> {
  await page.waitForFunction(
    rootId => {
      const host = document.getElementById(rootId)
      if (!host) return false
      return getComputedStyle(host).display !== 'none'
    },
    PULSE_ROOT_ID,
    { timeout: timeoutMs },
  )
}

export async function assertExactlyOnePulseRoot(page: Page): Promise<void> {
  const count = await page.locator(`#${PULSE_ROOT_ID}`).count()
  expect(count, 'exactly one #streamclone-pulse-root').toBe(1)
}

export async function pulseShadowText(page: Page): Promise<string> {
  return page.evaluate(rootId => {
    const host = document.getElementById(rootId)
    return host?.shadowRoot?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  }, PULSE_ROOT_ID)
}

export async function assertPulseShadowContains(page: Page, pattern: RegExp): Promise<void> {
  await expect
    .poll(async () => pulseShadowText(page), { timeout: 20_000 })
    .toMatch(pattern)
}

/** Game change dividers must paint above bars and span viewers → emotes (full plot height). */
export async function assertGameDividersSpanPlot(page: Page): Promise<void> {
  await expect(async () => {
    const measured = await page.evaluate(rootId => {
      const host = document.getElementById(rootId)
      const root = host?.shadowRoot
      if (!root) return null
      const svg = root.querySelector('svg')
      if (!svg) return null
      const viewBox = svg.getAttribute('viewBox')?.split(/\s+/).map(Number) ?? []
      const svgHeight = viewBox[3] ?? Number(svg.getAttribute('height')) ?? 0
      const lines = [...root.querySelectorAll('svg line[stroke="#f97316"]')]
      let maxY2 = 0
      for (const line of lines) {
        maxY2 = Math.max(maxY2, Number(line.getAttribute('y2') ?? 0))
      }
      return { count: lines.length, maxY2, svgHeight }
    }, PULSE_ROOT_ID)

    expect(measured, 'expected chart svg + game divider').not.toBeNull()
    expect(measured!.count).toBeGreaterThan(0)
    // Divider bottom should reach the plot floor (within axis/padding slack).
    expect(measured!.maxY2).toBeGreaterThan(measured!.svgHeight * 0.7)
    expect(measured!.svgHeight - measured!.maxY2).toBeLessThanOrEqual(24)
  }).toPass({ timeout: 20_000 })
}

/**
 * Live single-game charts paint a dashed orange right-edge "now" cap.
 * Left-edge game-change dividers may be absent.
 */
export async function assertLiveGameCapPresent(page: Page): Promise<void> {
  await expect(async () => {
    const measured = await page.evaluate(rootId => {
      const host = document.getElementById(rootId)
      const root = host?.shadowRoot
      if (!root) return null
      const svg = root.querySelector('svg')
      if (!svg) return null
      const viewBox = svg.getAttribute('viewBox')?.split(/\s+/).map(Number) ?? []
      const svgWidth = viewBox[2] ?? Number(svg.getAttribute('width')) ?? 0
      const caps = [...root.querySelectorAll('svg line[data-active-game-cap="true"]')]
      const orange = [...root.querySelectorAll('svg line[stroke="#f97316"]')]
      const dashed = orange.filter(line => Boolean(line.getAttribute('stroke-dasharray')))
      let rightmostCapX = 0
      for (const line of caps) {
        rightmostCapX = Math.max(rightmostCapX, Number(line.getAttribute('x1') ?? 0))
      }
      return {
        capCount: caps.length,
        dashedCount: dashed.length,
        rightmostCapX,
        svgWidth,
        capDashed: caps.every(line => Boolean(line.getAttribute('stroke-dasharray'))),
      }
    }, PULSE_ROOT_ID)

    expect(measured, 'expected chart svg + live game cap').not.toBeNull()
    expect(measured!.capCount, 'dashed live now-cap').toBeGreaterThanOrEqual(1)
    expect(measured!.capDashed, 'live now-cap stays dotted').toBe(true)
    // Cap sits near the right plot edge (pad slack).
    expect(measured!.rightmostCapX).toBeGreaterThan(measured!.svgWidth * 0.85)
  }).toPass({ timeout: 20_000 })
}

/** Selected moment card uses "Bookmark" (not legacy "Save"). */
export async function assertBookmarkLabel(page: Page): Promise<void> {
  await expect(async () => {
    const labels = await page.evaluate(rootId => {
      const host = document.getElementById(rootId)
      const root = host?.shadowRoot
      if (!root) return []
      return [...root.querySelectorAll('button')]
        .map(btn => (btn.textContent ?? '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    }, PULSE_ROOT_ID)
    expect(labels.some(l => l === 'Bookmark' || l.startsWith('Bookmark')), 'Bookmark CTA').toBe(
      true,
    )
    expect(
      labels.some(l => l === 'Save' || l === 'Saving…' || l === 'Saving...'),
      'legacy Save CTA must be gone',
    ).toBe(false)
  }).toPass({ timeout: 20_000 })
}

/** Click the selected-moment Bookmark button inside the Pulse shadow root. */
export async function clickBookmarkButton(page: Page): Promise<void> {
  const clicked = await page.evaluate(rootId => {
    const host = document.getElementById(rootId)
    const root = host?.shadowRoot
    if (!root) return false
    const btn = [...root.querySelectorAll('button')].find(el => {
      const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
      return t === 'Bookmark' || t.startsWith('Bookmark')
    })
    if (!btn) return false
    btn.click()
    return true
  }, PULSE_ROOT_ID)
  expect(clicked, 'Bookmark button').toBe(true)
}

/**
 * Click the first Most Reacted moment row inside the Pulse shadow root,
 * then wait for the selected-moment Bookmark CTA.
 */
export async function selectFirstMostReactedMoment(page: Page): Promise<void> {
  await expect
    .poll(async () => pulseShadowText(page), { timeout: 20_000 })
    .toMatch(/Most Reacted/i)

  const clicked = await page.evaluate(rootId => {
    const host = document.getElementById(rootId)
    const root = host?.shadowRoot
    if (!root) return false
    const rowButton =
      (root.querySelector('button.pulse-moment-row-button') as HTMLElement | null)
      ?? (root.querySelector('.pulse-moment-row') as HTMLElement | null)?.closest('button')
    if (rowButton) {
      rowButton.click()
      return true
    }
    const row = root.querySelector('.pulse-moment-row') as HTMLElement | null
    if (!row) return false
    row.click()
    return true
  }, PULSE_ROOT_ID)
  expect(clicked, 'expected a Most Reacted row to click').toBe(true)

  await expect(async () => {
    const hasBookmark = await page.evaluate(rootId => {
      const host = document.getElementById(rootId)
      const root = host?.shadowRoot
      if (!root) return false
      return [...root.querySelectorAll('button')].some(btn => {
        const t = (btn.textContent ?? '').replace(/\s+/g, ' ').trim()
        return t === 'Bookmark'
      })
    }, PULSE_ROOT_ID)
    expect(hasBookmark).toBe(true)
  }).toPass({ timeout: 20_000 })
}

/** Open Chart time range and pick a label through the extension Shadow DOM. */
export async function selectChartRangeOption(page: Page, optionLabel: string): Promise<void> {
  const trigger = page.getByRole('combobox', { name: 'Chart time range' })
  await expect(trigger).toBeVisible({ timeout: 10_000 })
  await trigger.click()

  const option = page.getByRole('option', { name: optionLabel, exact: true })
  await expect(option).toBeVisible({ timeout: 10_000 })
  await option.click()
  await expect(trigger).toContainText(optionLabel)
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
}

/** Click the partial-range "Full stream" chip in the chart range hint. */
export async function clickFullStreamChip(page: Page): Promise<void> {
  const clicked = await page.evaluate(rootId => {
    const host = document.getElementById(rootId)
    const root = host?.shadowRoot
    if (!root) return false
    const buttons = [...root.querySelectorAll('button')]
    const chip = buttons.find(btn => (btn.textContent ?? '').trim() === 'Full stream')
    if (!chip) return false
    chip.click()
    return true
  }, PULSE_ROOT_ID)
  expect(clicked, 'Full stream chip').toBe(true)
}

export function countBookmarkPosts(
  requests: { method: () => string; url: () => string }[],
): number {
  return requests.filter(
    r => r.method() === 'POST' && /\/v1\/pulse\/bookmarks(?:\?|$)/.test(r.url()),
  ).length
}

export function assertNoPulseVodDiscoverWarnings(evidence: EvidenceCollectors): void {
  const noisy = evidence.pageConsole.filter(line =>
    /\[Pulse vod\.discover\.(dom|gql)\].*no archive/i.test(line)
    && /\[warning\]|\[warn\]/i.test(line),
  )
  expect(noisy, `unexpected VOD discover warnings:\n${noisy.join('\n')}`).toEqual([])
}

const EXTENSION_CONTEXT_NOISE =
  /Access to storage is not allowed|Extension context invalidated|storage is not allowed from this context|<rect> attribute width: A negative value/i

export function assertNoUncaughtErrors(evidence: EvidenceCollectors): void {
  const pageErrors = evidence.pageErrors.filter(Boolean)
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([])

  const noisyConsole = evidence.pageConsole.filter(line => EXTENSION_CONTEXT_NOISE.test(line))
  expect(
    noisyConsole,
    `noisy page console (storage/context/SVG):\n${noisyConsole.join('\n')}`,
  ).toEqual([])

  const swExceptions = evidence.serviceWorkerConsole.filter(line =>
    /\[error\]|Uncaught|TypeError|ReferenceError/i.test(line),
  )
  expect(swExceptions, `service worker console errors:\n${swExceptions.join('\n')}`).toEqual([])
}

export function assertProductionManifestPermissions(): void {
  const manifest = JSON.parse(fs.readFileSync(EXTENSION_MANIFEST_PATH, 'utf8')) as {
    permissions?: string[]
    host_permissions?: string[]
    optional_host_permissions?: string[]
    name?: string
  }

  expect(manifest.name).toBe('StreamPulse')
  expect(manifest.permissions ?? []).toEqual([...EXPECTED_MANIFEST_PERMISSIONS])
  expect(manifest.host_permissions ?? []).toEqual([...EXPECTED_HOST_PERMISSIONS])
  expect(manifest.optional_host_permissions ?? []).toEqual([...EXPECTED_OPTIONAL_HOST_PERMISSIONS])

  for (const host of manifest.host_permissions ?? []) {
    for (const forbidden of FORBIDDEN_HOST_SUBSTRINGS) {
      expect(host.includes(forbidden), `unexpected host permission ${host}`).toBe(false)
    }
  }
}
