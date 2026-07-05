import { expect, test } from '@playwright/test'
import { attachConsoleErrorGuard, assertNoConsoleErrors } from './helpers/assertions'
import { seedBetaKey } from './helpers/auth'

const candidate = {
  id: 'cc-live-1',
  login: 'xqc',
  streamId: 'stream-1',
  vodId: 'vod-1',
  streamTitle: 'Late night set',
  streamCategory: 'Just Chatting',
  offsetSeconds: 120,
  startSeconds: 100,
  endSeconds: 160,
  score: 93,
  confidence: 0.82,
  reason: 'emote_spike',
  sourceKind: 'recap',
  sourceStatus: 'available',
  coverageState: 'ready',
  chatCount: 240,
  emoteCount: 190,
  topEmotes: [
    {
      name: 'KEKW',
      provider: 'seventv',
      count: 90,
    },
  ],
}

test.describe('dashboard clips queue', () => {
  test.beforeEach(async ({ page }) => {
    await seedBetaKey(page, 'test-beta-key')
  })

  test('reviews private auto-clip candidates with keyboard refresh and status clicks', async ({ page }) => {
    const errors = attachConsoleErrorGuard(page)
    let status: 'new' | 'saved' | 'dismissed' = 'new'
    let job: Record<string, string> | null = null
    let getCount = 0

    await page.route(/\/v1\/pulse\/clips(?:\?.*)?$/, async (route) => {
      const request = route.request()
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON() as { status?: 'new' | 'saved' | 'dismissed' }
        status = body.status ?? status
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'ccs-live-1', candidateId: candidate.id, status }),
        })
        return
      }

      getCount += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [{ ...candidate, state: { status }, ...(job ? { job } : {}) }] }),
      })
    })
    await page.route(/\/v1\/pulse\/clips\/cc-live-1$/, async (route) => {
      const body = route.request().postDataJSON() as { status?: 'new' | 'saved' | 'dismissed' }
      status = body.status ?? status
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'ccs-live-1', candidateId: candidate.id, status }),
      })
    })
    await page.route(/\/v1\/pulse\/clips\/cc-live-1\/replayforge$/, async (route) => {
      job = {
        id: 'ccj-live-1',
        candidateId: candidate.id,
        status: 'queued',
        replayForgeJobId: 'rf-live-1',
        replayForgeState: 'queued',
      }
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify(job),
      })
    })

    await page.goto('/dashboard/clips')

    await expect(page.getByRole('heading', { name: /StreamPulse Clips/i })).toBeVisible()
    await expect(page.getByText('Late night set')).toBeVisible()
    await expect(page.getByText('emote_spike')).toBeVisible()
    await expect(page.getByText('KEKW')).toBeVisible()
    await expect(page.getByRole('button', { name: /Render/i })).toBeDisabled()
    await expect(page.getByRole('button', { name: /Export/i })).toBeDisabled()

    await page.getByRole('button', { name: /Refresh/i }).focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => getCount).toBeGreaterThanOrEqual(2)

    await page.getByRole('button', { name: /^Save$/i }).click()
    await expect(page.locator('.clips-card').getByText(/^Saved$/)).toBeVisible()

    await page.getByRole('button', { name: /^Dismiss$/i }).click()
    await expect(page.locator('.clips-card').getByText(/^Dismissed$/)).toBeVisible()

    await page.getByRole('button', { name: /Send to ReplayForge/i }).click()
    await expect(page.locator('.clips-card').getByText(/ReplayForge queued/i)).toBeVisible()

    await page.getByRole('button', { name: /Refresh/i }).click()
    await expect(page.locator('.clips-card').getByText(/ReplayForge queued/i)).toBeVisible()

    await assertNoConsoleErrors(page, errors)
  })
})
