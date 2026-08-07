import fs from 'node:fs'
import { expect, type Page } from '@playwright/test'
import { EXTENSION_MANIFEST_PATH } from './extensionContext.ts'
import type { EvidenceCollectors } from './evidence.ts'

export const PULSE_ROOT_ID = 'streamclone-pulse-root'
export const PULSE_TABS_ID = 'streamclone-pulse-tabs'

/** Permissions intentionally allowed in the production manifest. */
export const EXPECTED_MANIFEST_PERMISSIONS = ['storage', 'scripting'] as const

/**
 * Host permissions intentionally allowed.
 * - localhost:8081 / 127.0.0.1:8081 — documented local StreamPulse BFF opt-in
 *   (see src/shared/storage.ts isLocalStackBackendUrl) and HTTP emote proxy.
 * - api.streampulse.stream — hosted Pulse API.
 * - *.twitch.tv — overlay injection + tab query/messaging for Twitch pages.
 * gql.twitch.tv is NOT required: Twitch GQL runs in page MAIN world via scripting.
 * Emote CDN hosts are NOT required: HTTPS emote `<img>` loads need no SW fetch;
 * only http://localhost emotes are proxied by the service worker.
 */
export const EXPECTED_HOST_PERMISSIONS = [
  'http://localhost:8081/*',
  'http://127.0.0.1:8081/*',
  'https://api.streampulse.stream/*',
  'https://*.twitch.tv/*',
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
  // Attribute selector — `#id` under-counts when duplicate ids exist in some engines.
  const count = await page.locator(`[id="${PULSE_ROOT_ID}"]`).count()
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

export async function assertPulseChartPresent(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(rootId => {
          const root = document.getElementById(rootId)?.shadowRoot
          return Boolean(
            root?.querySelector(
              '[role="img"][aria-label="Stream overview chart"], [role="img"][aria-label^="Activity chart"], .pulse-signal-wrap svg, .sc-chart-root svg',
            ),
          )
        }, PULSE_ROOT_ID),
      { timeout: 20_000 },
    )
    .toBe(true)
}

export async function assertNoSelectedMomentActions(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(rootId => {
          const root = document.getElementById(rootId)?.shadowRoot
          if (!root) return false
          return [...root.querySelectorAll('button')].every(button => {
            const label = (button.textContent ?? '').replace(/\s+/g, ' ').trim()
            return !/Jump in (player|VOD)/i.test(label)
          })
        }, PULSE_ROOT_ID),
      { timeout: 20_000 },
    )
    .toBe(true)
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

/** Selected moment card — Jump + Open Analytics (Bookmark removed). */
export async function assertSelectedMomentActions(page: Page): Promise<void> {
  await expect(async () => {
    const labels = await page.evaluate(rootId => {
      const host = document.getElementById(rootId)
      const root = host?.shadowRoot
      if (!root) return []
      return [...root.querySelectorAll('button')]
        .map(btn => (btn.textContent ?? '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    }, PULSE_ROOT_ID)
    expect(
      labels.some(l => /Jump in (player|VOD)|Open (VOD|Twitch replay)|Wait for VOD|Player unavailable/i.test(l)),
      'Jump CTA',
    ).toBe(true)
    expect(labels.some(l => l === 'Open Analytics'), 'Open Analytics CTA').toBe(true)
    expect(
      labels.some(l => l === 'Bookmark' || l.startsWith('Bookmark') || l === 'Save' || l.startsWith('Saving')),
      'Bookmark/Save CTA must be gone',
    ).toBe(false)
  }).toPass({ timeout: 20_000 })
}

/**
 * Click the first Most Reacted moment row inside the Pulse shadow root,
 * then wait for the selected-moment Jump CTA.
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
    const hasJump = await page.evaluate(rootId => {
      const host = document.getElementById(rootId)
      const root = host?.shadowRoot
      if (!root) return false
      return [...root.querySelectorAll('button')].some(btn => {
        const t = (btn.textContent ?? '').replace(/\s+/g, ' ').trim()
        return /Jump in (player|VOD)|Open (VOD|Twitch replay)|Wait for VOD|Player unavailable/i.test(t)
      })
    }, PULSE_ROOT_ID)
    expect(hasJump).toBe(true)
  }).toPass({ timeout: 20_000 })
}

/**
 * Open Chart time range (shadow) and pick a label from the body-portaled listbox.
 */
export async function selectChartRangeOption(page: Page, optionLabel: string): Promise<void> {
  const opened = await page.evaluate(rootId => {
    const host = document.getElementById(rootId)
    const btn = host?.shadowRoot?.querySelector(
      'button[aria-label="Chart time range"]',
    ) as HTMLButtonElement | null
    if (!btn) return false
    btn.click()
    return true
  }, PULSE_ROOT_ID)
  expect(opened, 'Chart time range trigger').toBe(true)

  // PulseThemedSelect portals options into the owning Pulse shadow root.
  await expect
    .poll(async () => {
      return page.evaluate((rootId, label) => {
        const host = document.getElementById(rootId)
        const root = host?.shadowRoot
        if (!root) return false
        const buttons = [...root.querySelectorAll('button[role="option"]')]
        const btn = buttons.find(el => (el.textContent ?? '').trim() === label) as HTMLButtonElement | undefined
        if (!btn) return false
        btn.click()
        return true
      }, PULSE_ROOT_ID, optionLabel)
    }, { timeout: 10_000 })
    .toBe(true)
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
  }

  expect(manifest.permissions ?? []).toEqual([...EXPECTED_MANIFEST_PERMISSIONS])
  expect(manifest.host_permissions ?? []).toEqual([...EXPECTED_HOST_PERMISSIONS])

  for (const host of manifest.host_permissions ?? []) {
    for (const forbidden of FORBIDDEN_HOST_SUBSTRINGS) {
      expect(host.includes(forbidden), `unexpected host permission ${host}`).toBe(false)
    }
  }
}
