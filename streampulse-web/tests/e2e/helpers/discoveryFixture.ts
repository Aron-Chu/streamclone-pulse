import type { Page } from '@playwright/test'
import { discoveryFixtureResponse } from '../../../scripts/fixtures/discoveryFixture.mjs'

/**
 * Playwright side of the stored-discovery fixture.
 *
 * The response builders live in `scripts/fixtures/discoveryFixture.mjs` so the
 * dev fixture server (`scripts/dev-discovery-fixture.mjs`) and these tests serve
 * byte-identical data — what you browse at :5173 is what CI asserts.
 */
export {
  FIXTURE_BROADCASTS,
  FIXTURE_CREATOR,
  FIXTURE_DAY,
  FIXTURE_MONTH,
  FIXTURE_PAGE_SIZE,
  FIXTURE_TOTAL_DETECTIONS,
} from '../../../scripts/fixtures/discoveryFixture.mjs'

import {
  FIXTURE_CREATOR as CREATOR,
  FIXTURE_DAY as DAY,
  FIXTURE_MONTH as MONTH,
} from '../../../scripts/fixtures/discoveryFixture.mjs'

/**
 * Serve the populated catalogue. Any other `/v1/` read resolves to an empty
 * object so a test never reaches the real backend by accident.
 */
export async function installDiscoveryFixture(page: Page): Promise<void> {
  await page.route('**/v1/**', route => {
    const url = new URL(route.request().url())
    const body = discoveryFixtureResponse(url.pathname, url.searchParams)
    return route.fulfill({ json: body ?? {} })
  })
}

export const FIXTURE_HISTORY_URL =
  `/analytics/moments?collection=history&month=${MONTH}&creator=${CREATOR}&day=${DAY}`

export const FIXTURE_MONTH_URL =
  `/analytics/moments?collection=history&month=${MONTH}&creator=${CREATOR}`
