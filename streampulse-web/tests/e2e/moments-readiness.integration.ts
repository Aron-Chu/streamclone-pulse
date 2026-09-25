import { test, expect } from '@playwright/test'
import { frozenExploreScope, isAllowedReadinessDataRequest, loadReconciliation } from './moments-readiness-preflight'

type RankedPage = {
  items: { id: string; rank: number; rankingVersion: string }[]
  rankingVersion: string
  asOf: string
  certificateGeneration: number
  indexedRetentionStart: string
  certifiedThroughExclusive: string
  nextCursor: string | null
}
type Availability = {
  schemaVersion: number
  state: string
  certifiedFrom: string
  certifiedThroughExclusive: string
  certificateGeneration: number
}

for (const width of [390, 768, 1440]) {
  test(`real ranked database reconciliation and local API boundary at ${width}px`, async ({ page }, info) => {
    const expected = loadReconciliation()
    const scope = frozenExploreScope(expected.explorePath)
    const violations: string[] = []
    const pages: { cursor: string | null; data: RankedPage }[] = []
    const availability: Availability[] = []
    const expectedQuery = new URLSearchParams({ from: scope.from, to: scope.to, sort: 'volume', limit: '50' })
    if (scope.login) expectedQuery.set('login', scope.login)
    if (scope.categoryMissing) expectedQuery.set('categoryMissing', 'true')
    else if (scope.category) expectedQuery.set('category', scope.category)
    page.on('request', request => {
      const url = new URL(request.url())
      if (!isAllowedReadinessDataRequest(url, request.method(), request.resourceType())) {
        violations.push(`${request.method()} ${url.origin}${url.pathname}`)
      }
    })
    page.on('response', async response => {
      const url = new URL(response.url())
      if (url.pathname === '/v1/public/discovery/ranked/availability') {
        const expectedAvailabilityQuery = scope.login ? `login=${scope.login}` : ''
        if (response.status() !== 200 || url.searchParams.toString() !== expectedAvailabilityQuery) {
          violations.push(`ranked availability status/scope ${response.status()}`)
          return
        }
        try {
          availability.push(await response.json() as Availability)
        } catch {
          violations.push('ranked availability response was not valid JSON')
        }
        return
      }
      if (url.pathname !== '/v1/public/discovery/ranked') return
      if (response.status() !== 200) {
        violations.push(`ranked status ${response.status()}`)
        return
      }
      const requestQuery = new URLSearchParams(url.searchParams)
      const cursor = requestQuery.get('cursor')
      requestQuery.delete('cursor')
      const entries = (query: URLSearchParams) => [...query.entries()].sort(([a], [b]) => a.localeCompare(b))
      if (JSON.stringify(entries(requestQuery)) !== JSON.stringify(entries(expectedQuery))
        || (url.searchParams.has('cursor') && !cursor)) {
        violations.push('ranked request did not match the frozen volume scope and 50-item page')
      }
      try {
        pages.push({ cursor, data: await response.json() as RankedPage })
      } catch {
        violations.push('ranked response was not valid JSON')
      }
    })
    await page.setViewportSize({ width, height: 900 })
    await page.goto(expected.explorePath)
    await expect(page.locator('.moments-result')).toHaveCount(50)
    await page.getByRole('button', { name: 'Load more moments (50)' }).click()
    await expect(page.locator('.moments-result')).toHaveCount(100)
    // Dev StrictMode may duplicate the first read. Identify each logical page
    // by the cursor returned by its predecessor, not by response arrival order.
    await expect.poll(() => pages.some(result => result.cursor === null)).toBe(true)
    const first = pages.filter(result => result.cursor === null).at(-1)?.data
    expect(first?.nextCursor).toBeTruthy()
    await expect.poll(() => pages.some(result => result.cursor === first!.nextCursor)).toBe(true)
    const second = pages.filter(result => result.cursor === first!.nextCursor).at(-1)?.data
    expect(second?.nextCursor).toBeTruthy()
    await page.getByRole('button', { name: 'Load more moments (50)' }).click()
    await expect.poll(() => page.locator('.moments-result').count()).toBeGreaterThan(100)
    await expect.poll(() => pages.some(result => result.cursor === second!.nextCursor)).toBe(true)
    const third = pages.filter(result => result.cursor === second!.nextCursor).at(-1)?.data
    expect(third?.items.length).toBeGreaterThan(0)
    await expect.poll(() => availability.length).toBeGreaterThan(0)
    const collectionPages = [first!, second!, third!]
    const certified = availability.at(-1)!
    expect(certified.schemaVersion).toBe(1)
    expect(certified.state).toBe('ready')
    expect(certified.certifiedFrom).toBe(first!.indexedRetentionStart)
    expect(certified.certifiedThroughExclusive).toBe(first!.certifiedThroughExclusive)
    expect(certified.certificateGeneration).toBe(first!.certificateGeneration)
    expect(scope.from >= certified.certifiedFrom && scope.to <= certified.certifiedThroughExclusive).toBe(true)
    expect(collectionPages.map(result => result.rankingVersion)).toEqual(Array(3).fill(expected.rankingVersion))
    for (const field of ['asOf', 'certificateGeneration', 'indexedRetentionStart', 'certifiedThroughExclusive'] as const) {
      expect(second![field]).toEqual(first![field])
      expect(third![field]).toEqual(first![field])
    }
    const items = collectionPages.flatMap(result => result.items)
    const reconciledCount = Math.min(items.length, expected.rankedIDs.length)
    expect(items.length).toBeGreaterThan(100)
    expect(items.slice(0, reconciledCount).map(item => item.id)).toEqual(expected.rankedIDs.slice(0, reconciledCount))
    expect(items.map(item => item.rank)).toEqual(Array.from({ length: items.length }, (_, i) => i + 1))
    expect(items.every(item => item.rankingVersion === expected.rankingVersion)).toBe(true)
    expect(await page.locator('.moments-result').evaluateAll(rows => rows.map(row => row.getAttribute('data-detection-id')))).toEqual(items.map(item => item.id))
    expect(await page.locator('.moments-result-rank').allTextContents()).toEqual(Array.from({ length: items.length }, (_, i) => `#${i + 1}`))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`real-ranked-${width}.png`), fullPage: true })
    const savedKey = await page.locator('.moments-result .moments-card-primary').first().getAttribute('data-discovery-key')
    expect(savedKey).toBeTruthy()
    await page.locator('.moments-result').first().getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'Saved (1)', exact: true })).toBeVisible()
    await page.locator('.moments-card-primary').first().click()
    await expect(page.getByRole('region', { name: 'Selected moment', exact: true })).toBeVisible()
    await expect(page.locator('.moments-result.is-selected').first()).toHaveAttribute('data-detection-id', expected.rankedIDs[0])
    await page.screenshot({ path: info.outputPath(`real-detail-${width}.png`) })
    await page.goBack()
    await page.reload()
    await expect(page.locator('.moments-result')).toHaveCount(50)
    await page.getByRole('tab', { name: 'Saved (1)', exact: true }).click()
    await expect(page.locator('.moments-result')).toHaveCount(1)
    await expect(page.locator('.moments-result .moments-card-primary')).toHaveAttribute('data-discovery-key', savedKey!)
    expect(violations).toEqual([])
  })
}
