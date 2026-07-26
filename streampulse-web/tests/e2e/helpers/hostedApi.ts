import { expect, type Page } from '@playwright/test'

/** Hosted StreamPulse API — default for portal e2e and visual capture. */
export const HOSTED_API_URL = 'https://api.streampulse.stream'

const LOCAL_API_PATTERN = /https?:\/\/(localhost|127\.0\.0\.1|laptopworker):(8081|8090)/i

/** Clear session overrides that can repoint the portal at a local backend stack. */
export async function clearBackendOverrides(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      sessionStorage.removeItem('sp.backendUrlOverride')
      localStorage.removeItem('sp.backendUrlOverride')
    } catch {
      /* ignore */
    }
  })
}

/** Fail the test if any request hits a local backend (hosted-only guard). */
export function attachHostedApiGuard(page: Page): string[] {
  const violations: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (LOCAL_API_PATTERN.test(url)) {
      violations.push(url)
    }
  })
  return violations
}

export function assertHostedApiOnly(violations: string[]): void {
  expect(
    violations,
    `Expected hosted API only (${HOSTED_API_URL}); local stack requests:\n${violations.join('\n')}`,
  ).toEqual([])
}

function isHostedApiResponseUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname === 'api.streampulse.stream'
  } catch {
    return false
  }
}

/** Wait until at least one hosted API response completes (proves the page is not on localhost). */
export async function waitForHostedApiTraffic(page: Page, timeoutMs = 45_000): Promise<void> {
  await page.waitForResponse(
    (response) => isHostedApiResponseUrl(response.url()) && response.status() < 500,
    { timeout: timeoutMs },
  )
}
