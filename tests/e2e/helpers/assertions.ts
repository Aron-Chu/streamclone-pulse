import fs from 'node:fs'
import { expect, type Page } from '@playwright/test'
import { EXTENSION_MANIFEST_PATH } from './extensionContext.ts'
import type { EvidenceCollectors } from './evidence.ts'

export const PULSE_ROOT_ID = 'streamclone-pulse-root'
export const PULSE_TABS_ID = 'streamclone-pulse-tabs'

/** Permissions intentionally allowed in the production manifest. */
export const EXPECTED_MANIFEST_PERMISSIONS = ['storage', 'scripting', 'tabs'] as const

/**
 * Host permissions intentionally allowed.
 * localhost:8081 / 127.0.0.1:8081 are the documented local StreamPulse BFF opt-in
 * (see src/shared/storage.ts isLocalStackBackendUrl) — not removed by this suite.
 */
export const EXPECTED_HOST_PERMISSIONS = [
  'http://localhost:8081/*',
  'http://127.0.0.1:8081/*',
  'https://api.streampulse.stream/*',
  'https://cdn.7tv.app/*',
  'https://static-cdn.jtvnw.net/*',
  'https://cdn.frankerfacez.com/*',
  'https://gql.twitch.tv/*',
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

export function assertNoUncaughtErrors(evidence: EvidenceCollectors): void {
  const pageErrors = evidence.pageErrors.filter(Boolean)
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([])

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
