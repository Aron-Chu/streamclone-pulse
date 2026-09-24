import { test, expect } from '@playwright/test'
import { installHubUxMock } from './helpers/hubUxMock'
import { installNewsroomMock, newsroomFixture } from './helpers/newsroomMock'
import portalTimingFixture from '../fixtures/portal_vod_timing_v1.json' with { type: 'json' }

// Embedded Twitch playback requires a review panel at least 400px wide.
test.use({ viewport: { width: 1920, height: 1080 } })

test('failed legacy session resolution keeps a retryable original link', async ({ page }) => {
  await installHubUxMock(page)
  await page.route('**/v1/public/newsroom**', route => route.fulfill({ status: 503, json: { error: 'newsroom_unavailable' } }))
  await page.goto('/analytics/moments?view=sessions&story=missing')
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
  await expect(page.getByText('No session summaries available.', { exact: true })).toHaveCount(0)
  await expect(page.getByText('This broadcast link could not be resolved.', { exact: false })).toBeVisible()
})

test('live archive recovery keeps the selected broadcast and enables only its exact replay', async ({ page }) => {
  let linked = false
  await page.route(/\/v1\/portal\/analytics\/streams\/321192454233(?:\?.*)?$/, route => route.fulfill({ json: linked
    ? { ...portalTimingFixture, state: 'live', availability: { liveDvrState: 'live', vodState: 'linked' } }
    : { channel: 'xqc', stream: { streamId: '321192454233' }, availability: { liveDvrState: 'live', vodState: 'pending_live' } },
  }))
  await page.route('**/v1/portal/analytics/streams/321192454233/recap', route => route.fulfill({ json: {
    login: 'xqc', streamId: '321192454233', topMoments: [{ offsetSeconds: 5183, reasons: ['chat_spike'] }],
  } }))
  await page.goto('/analytics/moments?login=xqc&stream=321192454233&offset=5183')
  const detail = page.getByRole('region', { name: 'Selected moment', exact: true })
  await expect(detail.getByRole('button', { name: 'Recheck source', exact: true })).toBeVisible()
  await expect(detail.getByRole('link', { name: /^Open VOD at/ })).toHaveCount(0)
  await expect(detail.locator('iframe')).toHaveCount(0)
  linked = true
  await detail.getByRole('button', { name: 'Recheck source', exact: true }).click()
  await expect(detail.getByRole('link', { name: /^Open VOD at/ })).toHaveAttribute('href', 'https://www.twitch.tv/videos/2864434763?t=5107s')
  await expect(page).toHaveURL(/stream=321192454233&offset=5183/)
  await detail.getByRole('button', { name: /Load Twitch preview/ }).click()
  await expect(detail.locator('iframe')).toHaveAttribute('src', /video=v2864434763&time=5107s&parent=127.0.0.1&autoplay=false/)
  await page.reload()
  await expect(detail.getByRole('link', { name: /^Open VOD at/ })).toHaveAttribute('href', 'https://www.twitch.tv/videos/2864434763?t=5107s')
})

test('archive-origin contract maps the selected replay and preserves Save outside the playable range', async ({ page }) => {
  await page.route(/\/v1\/portal\/analytics\/streams\/321192454233(?:\?.*)?$/, route => route.fulfill({ json: portalTimingFixture }))
  await page.route('**/v1/portal/analytics/streams/321192454233/recap', route => route.fulfill({ json: {
    login: 'xqc', streamId: '321192454233', topMoments: [{ offsetSeconds: 5183, reasons: ['chat_spike'], topEmotes: [{ code: 'KEKW', count: 45, provider: 'seventv' }] }],
  } }))
  await page.goto('/analytics/moments?login=xqc&stream=321192454233&offset=5183')
  const detail = page.getByRole('region', { name: 'Selected moment', exact: true })
  await expect(detail.getByRole('link', { name: /^Open VOD at/ })).toHaveAttribute('href', 'https://www.twitch.tv/videos/2864434763?t=5107s')
  await page.goto('/analytics/moments?login=xqc&stream=321192454233&offset=18100')
  await expect(detail.locator('.moment-replay-pending').getByText('This detection is outside the archive', { exact: false })).toBeVisible()
  await expect(detail.getByRole('link', { name: /^Open VOD at/ })).toHaveCount(0)
  await expect(detail.locator('iframe')).toHaveCount(0)
  await detail.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Saved (1)', exact: true })).toBeVisible()
  // A growing archive can become available on an explicit recheck, without
  // changing the selected identity or navigating to a different broadcast.
  await page.route(/\/v1\/portal\/analytics\/streams\/321192454233(?:\?.*)?$/, route => route.fulfill({ json: { ...portalTimingFixture, vodDurationSeconds: 19000 } }))
  await detail.getByRole('button', { name: 'Recheck source', exact: true }).click()
  await expect(detail.getByRole('link', { name: /^Open VOD at/ })).toHaveAttribute('href', 'https://www.twitch.tv/videos/2864434763?t=18024s')
})

test('a deep-linked detection outside recent results restores exact recap reactions on refresh', async ({ page }) => {
  await page.route('**/v1/portal/analytics/streams/s1/recap', route => route.fulfill({ json: {
    login: 'xqc', streamId: 's1', topMoments: [
      { offsetSeconds: 1, topEmotes: [{ code: 'Wrong lead' }] },
      { offsetSeconds: 17058, reasons: ['twitch_emote_spike'], topEmotes: [{ code: 'GTAB', count: 32, provider: 'seventv' }] },
    ],
  } }))
  await page.route(/\/v1\/portal\/analytics\/streams\/s1(?:\?.*)?$/, route => route.fulfill({ json: {
    channel: 'xqc', stream: { streamId: 's1', startedAt: '2026-09-05T00:04:42Z' }, availability: { vodState: 'pending_live' },
  } }))
  await page.goto('/analytics/moments?login=xqc&stream=s1&offset=17058')
  const detail = page.locator('.moments-detail')
  await expect(detail.getByRole('heading', { name: 'Emote spike', exact: true })).toBeVisible()
  await expect(detail.getByText('GTAB', { exact: true })).toBeVisible()
  await expect(detail.getByText('7TV', { exact: true })).toBeVisible()
  await expect(detail.getByText('32 uses', { exact: true })).toBeVisible()
  await expect(detail.getByText('Wrong lead', { exact: true })).toHaveCount(0)
  await expect(detail.getByText('Occurrence time unavailable', { exact: false })).toHaveCount(0)
  await expect(detail.getByRole('link', { name: /^Open VOD at/ })).toHaveCount(0)
  await page.reload()
  await expect(detail.getByText('GTAB', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.moments-toolbar')).toBeHidden()
  await detail.getByRole('button', { name: 'Back to results' }).click()
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await expect(page.locator('.moments-toolbar')).toBeVisible()
})

test('late recap responses cannot overwrite a different selection and failed evidence is retryable', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let started!: () => void
  const entered = new Promise<void>(resolve => { started = resolve })
  await page.route('**/v1/portal/analytics/streams/old/recap', async route => {
    started(); await gate
    await route.fulfill({ json: { login: 'xqc', streamId: 'old', topMoments: [{ offsetSeconds: 9999, topEmotes: [{ code: 'Obsolete reaction' }] }] } }).catch(() => {})
  })
  await page.goto('/analytics/moments?login=xqc&stream=old&offset=9999')
  await entered
  await page.locator('.moments-detail').getByRole('button', { name: 'Back to results' }).click()
  await page.locator('.moments-result').first().getByRole('button', { name: 'Open moment' }).click()
  release()
  await expect(page.locator('.moments-detail').getByText('Obsolete reaction')).toHaveCount(0)
  let recovered = false
  await page.route('**/v1/portal/analytics/streams/old/recap', route => recovered
    ? route.fulfill({ json: { login: 'xqc', streamId: 'old', topMoments: [{ offsetSeconds: 9999, topEmotes: [{ code: 'Recovered reaction' }] }] } })
    : route.fulfill({ status: 403, json: {} }))
  await page.goto('/analytics/moments?login=xqc&stream=old&offset=9999')
  await expect(page.getByText('Reaction details could not be loaded.', { exact: false })).toBeVisible()
  recovered = true
  await page.getByRole('button', { name: 'Retry reaction details' }).click()
  await expect(page.getByText('Recovered reaction', { exact: true })).toBeVisible()
})

test.beforeEach(async ({ page }) => {
  await installHubUxMock(page)
  await installNewsroomMock(page)
  await page.route('**/v1/portal/analytics/streams/*', async route => {
    const streamId = new URL(route.request().url()).pathname.split('/').pop()
    await route.fulfill({ json: { vodTiming: { state: 'verified' }, vodDurationSeconds: 18000, vodAlignSeconds: 0,
      handoffRef: 'cr_Y2NfYWJj', channel: streamId === 's1' ? 'xqc' : 'sodapoppin', stream: { streamId, vodId: '123456' } } })
  })
})

test('pending replay recovers automatically for the same selected broadcast', async ({ page }) => {
  await page.clock.install()
  let linked = false
  let reads = 0
  await page.route(/\/v1\/portal\/analytics\/streams\/s1(?:\?.*)?$/, route => {
    if (new URL(route.request().url()).searchParams.get('momentOffsetSeconds') === '120') reads++
    return route.fulfill({ json: linked
      ? { channel: 'xqc', stream: { streamId: 's1', vodId: '123456' }, vodTiming: { state: 'verified' }, vodAlignSeconds: 0, vodDurationSeconds: 18000 }
      : { channel: 'xqc', stream: { streamId: 's1' }, vodTiming: { state: 'unavailable', reason: 'archive_not_linked' }, availability: { vodState: 'pending_live' } } })
  })
  await page.goto('/analytics/moments?login=xqc&stream=s1&offset=120')
  const detail = page.getByRole('region', { name: 'Selected moment', exact: true })
  await expect(detail.getByText('Waiting for this broadcast’s archive', { exact: true })).toBeVisible()
  await expect(detail.locator('iframe')).toHaveCount(0)
  const initialReads = reads
  expect(initialReads).toBeGreaterThan(0)
  linked = true
  await page.clock.fastForward(60_000)
  await detail.getByRole('button', { name: /Load Twitch preview/ }).click()
  await expect(detail.locator('iframe')).toHaveAttribute('src', /video=v123456&time=120s/)
  expect(reads).toBe(initialReads + 1)
  await page.clock.fastForward(180_000)
  expect(reads).toBe(initialReads + 1)
})

test('pending replay retries stop after five checks and manual retry restarts recovery', async ({ page }) => {
  await page.clock.install()
  let reads = 0
  await page.route(/\/v1\/portal\/analytics\/streams\/s1(?:\?.*)?$/, route => {
    if (new URL(route.request().url()).searchParams.get('momentOffsetSeconds') === '120') reads++
    return route.fulfill({ json: { channel: 'xqc', stream: { streamId: 's1' }, availability: { vodState: 'pending_live' } } })
  })
  await page.goto('/analytics/moments?login=xqc&stream=s1&offset=120')
  const detail = page.getByRole('region', { name: 'Selected moment', exact: true })
  await expect(detail.getByRole('button', { name: 'Check replay now' })).toBeVisible()
  const initialReads = reads
  for (let attempt = 1; attempt <= 5; attempt++) {
    await page.clock.fastForward(60_000)
    await expect.poll(() => reads).toBe(initialReads + attempt)
    await expect(detail.getByRole('button', { name: 'Check replay now' })).toBeVisible()
  }
  await expect(detail.getByText('We’ll recheck automatically while this page is open.')).toHaveCount(0)
  await page.clock.fastForward(300_000)
  expect(reads).toBe(initialReads + 5)
  await detail.getByRole('button', { name: 'Check replay now' }).click()
  await expect(detail.getByText('We’ll recheck automatically while this page is open.')).toBeVisible()
  expect(reads).toBe(initialReads + 6)
})

test('rechecking keeps the player mounted through slow and failed lookups but clears revoked mappings', async ({ page }) => {
  let state: 'ready' | 'slow' | 'failed' | 'unlinked' = 'ready'
  let release: (() => void) | undefined
  await page.route(/\/v1\/portal\/analytics\/streams\/s1(?:\?.*)?$/, async route => {
    if (state === 'slow') await new Promise<void>(resolve => { release = resolve })
    if (state === 'failed') return route.fulfill({ status: 503, json: { error: 'temporarily_unavailable' } })
    return route.fulfill({ json: state === 'unlinked'
      ? { channel: 'xqc', stream: { streamId: 's1' }, availability: { vodState: 'unavailable' } }
      : { channel: 'xqc', stream: { streamId: 's1', vodId: '123456' }, vodTiming: { state: 'verified' }, vodAlignSeconds: 0, vodDurationSeconds: 18000 } })
  })
  await page.goto('/analytics/moments?login=xqc&stream=s1&offset=120')
  const detail = page.getByRole('region', { name: 'Selected moment', exact: true })
  await detail.getByRole('button', { name: /Load Twitch preview/ }).click()
  await expect(detail.locator('iframe')).toHaveAttribute('src', /video=v123456&time=120s/)
  const original = await detail.locator('iframe').elementHandle()
  await detail.locator('.moments-source > summary').click()
  state = 'slow'
  await detail.getByRole('button', { name: 'Recheck source', exact: true }).click()
  await expect(detail.getByText('Rechecking source without restarting the preview…')).toBeVisible()
  expect(await original!.evaluate(element => element.isConnected)).toBe(true)
  await expect.poll(() => Boolean(release)).toBe(true)
  release!()
  await expect(detail.getByRole('button', { name: 'Recheck source', exact: true })).toBeVisible()
  expect(await original!.evaluate(element => element.isConnected)).toBe(true)
  state = 'failed'
  await detail.getByRole('button', { name: 'Recheck source', exact: true }).click()
  await expect(detail.getByText('Could not recheck this source.', { exact: false }).first()).toBeVisible()
  expect(await original!.evaluate(element => element.isConnected)).toBe(true)
  state = 'unlinked'
  await detail.getByRole('button', { name: 'Recheck source', exact: true }).click()
  await expect(detail.locator('iframe')).toHaveCount(0)
  await expect(detail.getByRole('link', { name: /^Open VOD at/ })).toHaveCount(0)
})

test('designed menus support keyboard selection and reduced motion on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/analytics/moments')
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  const trigger = page.getByRole('combobox', { name: 'Sort loaded results' })
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  const menu = page.getByRole('listbox', { name: 'Sort loaded results' })
  await expect(menu).toBeVisible()
  await expect(menu).toHaveCSS('animation-name', 'moment-menu-enter')
  const bounds = await menu.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(trigger).toHaveText('Oldest first')
  await expect(trigger).toBeFocused()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await trigger.click()
  await expect(menu).toHaveCSS('animation-name', 'none')
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})

test('moment evidence bars and saved notes survive reload without replacing the source', async ({ page }, testInfo) => {
  await installHubUxMock(page, { withComparisons: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/analytics/moments')
  await page.locator('[data-discovery-key]').first().click()
  const selected = page.getByRole('region', { name: 'Selected moment', exact: true })
  const chart = selected.getByRole('figure', { name: 'Reaction compared with earlier stream activity' })
  await expect(chart).toBeVisible()
  // One log-scaled ratio per measured signal, against a labelled 1× origin: a
  // shared linear scale made the earlier average vanish as the spike grew.
  await expect(chart.locator('.moment-ratio__track')).toHaveCount(2)
  await expect(chart.locator('.moment-ratio__tick[data-origin="true"]').first()).toHaveText('1×')
  await expect(chart.getByText(/earlier average/).first()).toBeVisible()
  await expect(selected.locator('.moment-emote-track')).toHaveCount(2)
  await selected.getByRole('button', { name: 'Save', exact: true }).click()
  await selected.getByLabel('Why keep this moment?').fill('Keep the lead-in before the reaction.')
  await selected.getByRole('button', { name: 'Save note', exact: true }).click()
  await expect(selected.getByText('Note saved on this device.')).toBeVisible()
  const selectedUrl = page.url()
  await page.reload()
  await expect(selected.getByLabel('Why keep this moment?')).toHaveValue('Keep the lead-in before the reaction.')
  await expect(page).toHaveURL(selectedUrl)
  await selected.screenshot({ path: testInfo.outputPath('moment-review.png') })
  await page.getByRole('tab', { name: 'Saved (1)', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Browse loaded categories' })).toHaveCount(0)
  await expect(page.locator('.moments-result')).toHaveCount(1)
})

test('legacy Saved title stays historical when an exact recap adds reactions', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('streampulse.saved-moments.v1', JSON.stringify({
    version: 1, items: [{ login: 'xqc', streamId: 'legacy-stream', offsetSeconds: 120,
      at: Date.parse('2026-09-22T00:02:00Z'), label: 'Original saved title',
      displayName: 'xQc', savedAt: Date.parse('2026-09-22T01:00:00Z'), note: 'Keep this one' }],
  })))
  await page.route('**/v1/portal/analytics/streams/legacy-stream/recap', route => route.fulfill({ json: {
    login: 'xqc', streamId: 'legacy-stream', topMoments: [{ offsetSeconds: 120,
      reasons: ['emote_spike'], topEmotes: [{ code: 'KEKW', count: 27, provider: 'seventv' }] }],
  } }))
  await page.route(/\/v1\/portal\/analytics\/streams\/legacy-stream(?:\?.*)?$/, route => route.fulfill({ json: {
    channel: 'xqc', stream: { streamId: 'legacy-stream', login: 'xqc' }, availability: { vodState: 'unavailable' },
  } }))
  await page.goto('/analytics/moments?view=saved')
  const row = page.locator('.moments-result').first()
  await expect(row).toContainText('Original saved title')
  await row.getByRole('button', { name: 'Open moment' }).click()
  const detail = page.getByRole('region', { name: 'Selected moment', exact: true })
  await expect(detail.getByText('KEKW', { exact: true })).toBeVisible()
  await expect(detail.getByRole('heading', { name: 'Original saved title' })).toBeVisible()
  const measurement = detail.getByRole('region', { name: 'Moment measurement' })
  await expect(measurement.locator('dd').nth(0)).toHaveText('Unavailable')
  await expect(measurement.locator('dd').nth(1)).toHaveText('Unavailable')
  await expect(detail.getByLabel('Why keep this moment?')).toHaveValue('Keep this one')
})

test('Live Wire preserves opened measurements when Recent no longer supplies the detection', async ({ page }) => {
  await page.goto('/analytics')
  const open = page.getByRole('link', { name: /^Open moment for xQc/ }).first()
  await expect(open).toBeVisible()
  await installHubUxMock(page, { mode: 'empty' })
  await open.click()
  const detail = page.getByRole('region', { name: 'Selected moment', exact: true })
  const measurement = detail.getByRole('region', { name: 'Moment measurement' })
  await expect(measurement.locator('dd').nth(0)).toHaveText('393')
  await expect(measurement.locator('dd').nth(1)).toHaveText('133')
  await page.reload()
  await expect(page.locator('.moments-result')).toHaveCount(0)
  await expect(measurement.locator('dd').nth(0)).toHaveText('393')
  await expect(measurement.locator('dd').nth(1)).toHaveText('133')
  await expect(detail.getByText('Selection outside loaded matches', { exact: true })).toBeVisible()
  await expect(detail.getByRole('link', { name: /^Open VOD at/ })).toHaveAttribute('href', 'https://www.twitch.tv/videos/123456?t=120s')
  // A different exact URL must never inherit the previously opened row.
  await page.goto('/analytics/moments?view=recent&login=xqc&stream=s1&offset=9999')
  await expect(measurement.locator('dd').nth(0)).toHaveText('Unavailable')
})

test('exact moment source, device save, reload and legacy session link', async ({ page }) => {
  const exactRefreshes: string[] = []
  page.on('request', request => { if (request.url().includes('momentOffsetSeconds=')) exactRefreshes.push(request.url()) })
  await installHubUxMock(page, { firstMomentHandoffRef: 'cr_c3RhbGU' })
  await installNewsroomMock(page)
  await page.goto('/analytics/moments')
  await expect(page.locator('.moments-result')).toHaveCount(2)
  await page.locator('.moments-result').first().getByRole('button', { name: 'Open moment' }).click()
  await expect(page.getByRole('link', { name: /^Open VOD at/ })).toHaveAttribute('href', 'https://www.twitch.tv/videos/123456?t=120s')
  const prepare = page.getByRole('link', { name: /Prepare clip in ReplayForge/ })
  if (process.env.VITE_REPLAYFORGE_UI_ORIGIN) {
    await expect(prepare).toHaveAttribute('href', `${process.env.VITE_REPLAYFORGE_UI_ORIGIN}/handoff/streampulse/cr_Y2NfYWJj`)
    await expect(prepare).not.toHaveAttribute('href', /cr_c3RhbGU/)
  } else {
    await expect(prepare).toHaveCount(0)
  }
  await page.locator('.moments-detail').getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('tab', { name: 'Saved (1)', exact: true }).click()
  await expect(page.getByText('Saved in this browser · not synced to the extension or your account.')).toBeVisible()
  await page.reload()
  await expect(page.locator('.moments-result')).toHaveCount(1)
  await page.locator('.moments-result').getByRole('button', { name: 'Open moment' }).click()
  await expect(page.getByRole('link', { name: /^Open VOD at/ })).toBeVisible()
  await expect.poll(() => exactRefreshes.some(url => new URL(url).searchParams.get('momentOffsetSeconds') === '120')).toBe(true)
  if (process.env.VITE_REPLAYFORGE_UI_ORIGIN) {
    await expect(page.getByRole('link', { name: /Prepare clip in ReplayForge/ })).toHaveAttribute('href', `${process.env.VITE_REPLAYFORGE_UI_ORIGIN}/handoff/streampulse/cr_Y2NfYWJj`)
  } else {
    await expect(page.getByRole('link', { name: /Prepare clip in ReplayForge/ })).toHaveCount(0)
  }
  expect(await page.evaluate(() => localStorage.getItem('streampulse.saved-moments.v2'))).not.toContain('handoffRef')
  await page.goto('/analytics/newsroom/story-xqc?window=live#keep')
  await expect(page).toHaveURL(/analytics\/explore\/story-xqc\?window=live#keep$/)
  await expect(page.getByRole('heading', { name: 'Pulse Explorer', exact: true })).toBeVisible()
})

test('category survives detail and browser back; retired Sessions bookmarks reach Explorer', async ({ page }) => {
  await page.goto('/analytics/moments')
  await page.getByRole('combobox', { name: 'Category', exact: true }).click()
  await page.getByRole('option', { name: 'Minecraft', exact: true }).click()
  await expect(page.locator('.moments-result')).toHaveCount(1)
  await page.locator('.moments-result').getByRole('button', { name: 'Open moment' }).click()
  await page.goBack()
  await expect(page.getByRole('combobox', { name: 'Category', exact: true })).toHaveText('Minecraft')
  await expect(page.locator('.moments-result')).toHaveCount(1)
  await expect(page.locator('.moments-result').getByRole('button', { name: 'Open moment' })).toBeFocused()
  await page.goto('/analytics/moments?view=sessions&window=7d')
  await expect(page).toHaveURL(/\/analytics\/explore\?window=7d$/)
  await expect(page.getByRole('heading', { name: 'Pulse Explorer', exact: true })).toBeVisible()
})

test('creator navigation opens stored history and Back restores browse filters', async ({ page }) => {
  await page.route('**/v1/public/discovery/ranked?*', route => route.fulfill({ status: 404, json: {} }))
  await page.goto('/analytics/moments')
  await page.getByRole('combobox', { name: 'Category', exact: true }).click()
  await page.getByRole('option', { name: 'Minecraft', exact: true }).click()
  await expect(page.locator('.moments-result')).toHaveCount(1)
  const creator = page.locator('.moments-result').getByRole('link', { name: /^Browse .* history$/ })
  const href = await creator.getAttribute('href')
  const creatorUrl = new URL(href!, 'http://127.0.0.1:5173')
  expect(creatorUrl.pathname).toBe('/analytics/moments')
  expect(creatorUrl.searchParams.get('view')).toBe('history')
  expect(creatorUrl.searchParams.get('scope')).toBe('creator')
  expect(creatorUrl.searchParams.get('creator')).toBe('xqc')
  await creator.click()
  await expect(page).toHaveURL(url => {
    const next = new URL(url)
    return next.pathname === '/analytics/moments'
      && next.searchParams.get('view') === 'history'
      && next.searchParams.get('scope') === 'creator'
      && next.searchParams.get('creator') === 'xqc'
  })
  await expect(page.getByRole('heading', { name: 'History unavailable' })).toBeVisible()
  await expect(page.locator('.moments-detail')).toHaveCount(0)
  await page.goBack()
  await expect(page.getByRole('combobox', { name: 'Category', exact: true })).toHaveText('Minecraft')
  await expect(page.locator('.moments-result')).toHaveCount(1)
  await expect(creator).toBeFocused()
})

test('in-page Back does not leave a detail entry that browser Back reopens', async ({ page }) => {
  await page.goto('/analytics')
  await page.getByRole('navigation', { name: 'Analytics navigation' }).getByRole('link', { name: 'All moments', exact: true }).click()
  await page.locator('.moments-result').first().getByRole('button', { name: 'Open moment' }).click()
  await expect(page.locator('.moments-detail')).toBeVisible()
  // Revisit this detail after unmounting the page: its return origin must be
  // stored on the history entry, not only in a component ref.
  await page.getByRole('navigation', { name: 'Analytics navigation' }).getByRole('link', { name: 'Analytics', exact: true }).click()
  await page.goBack()
  await expect(page.locator('.moments-detail')).toBeVisible()
  await page.getByRole('button', { name: 'Back to results' }).click()
  await expect(page.locator('.moments-detail')).toHaveCount(0)
  await expect(page.locator('.moments-result').first().getByRole('button', { name: 'Open moment' })).toBeFocused()
  await page.goBack()
  await expect(page).toHaveURL(/\/analytics$/)
})

test('archive start keeps opt-in preview and exact zero timestamp', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/analytics/moments?login=xqc&stream=s1&offset=0')
  await expect(page.getByRole('link', { name: /^Open VOD at/ })).toHaveAttribute('href', 'https://www.twitch.tv/videos/123456?t=0s')
  await expect(page.locator('.moments-detail iframe')).toHaveCount(0)
  await page.getByRole('button', { name: /Load Twitch preview/ }).click()
  await expect(page.locator('.moments-detail iframe')).toHaveAttribute('src', /time=0s&/)
})

test('invalid supplied avatar recovers consistently in results and selected review', async ({ page }) => {
  await installHubUxMock(page, { firstMomentProfileImageUrl: 'https://untrusted.invalid/avatar.jpg' })
  const photo = 'https://static-cdn.jtvnw.net/jtv_user_pictures/fixture-profile.png'
  let unsafeRequests = 0
  let profileRequests = 0
  let releaseProfile!: () => void
  const profileReady = new Promise<void>(resolve => { releaseProfile = resolve })
  page.on('request', request => { if (request.url().includes('untrusted.invalid')) unsafeRequests++ })
  await page.route('**/v1/channels/xqc', async route => {
    profileRequests++
    await profileReady
    await route.fulfill({ json: { login: 'xqc', profileImageUrl: photo } })
  })
  await page.route(photo, route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#222"/></svg>' }))
  await page.goto('/analytics/moments')
  await expect.poll(() => profileRequests).toBe(1)
  await page.locator('.moments-result').first().getByRole('button', { name: 'Open moment' }).click()
  await expect(page.locator('.moments-detail')).toBeVisible()
  releaseProfile()
  await expect(page.locator('.moments-detail img.moments-avatar')).toHaveAttribute('src', photo)
  await page.getByRole('button', { name: 'Back to results' }).click()
  await expect(page.locator('.moments-result').first().locator('img.moments-avatar')).toHaveAttribute('src', photo)
  expect(profileRequests).toBe(1)
  expect(unsafeRequests).toBe(0)
})

test('storage failure has one workspace warning rather than a warning per card', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('streampulse.saved-moments.v1', 'malformed'))
  await page.goto('/analytics/moments')
  await expect(page.locator('.moments-result')).toHaveCount(2)
  await expect(page.getByText('Saved data could not be read.', { exact: false })).toHaveCount(1)
  await page.locator('.moments-result').first().getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved for this session only.', { exact: true })).toHaveCount(1)
  await expect(page.getByText('Saved data could not be read.', { exact: false })).toHaveCount(1)
})

test('reviewed archive artwork returns only to its exact card without background source lookups', async ({ page }) => {
  let checks = 0
  const artwork = { vodId: '123456', kind: 'archive_thumbnail', url: 'https://static-cdn.jtvnw.net/cf_vods/fixture/thumb/preview.jpg' }
  await page.route(artwork.url, route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#222"/></svg>' }))
  await page.route(/\/v1\/portal\/analytics\/streams\/s1(?:\?.*)?$/, route => {
    checks++
    return route.fulfill({ json: { vodTiming: { state: 'verified' }, vodDurationSeconds: 18000, vodAlignSeconds: 0, channel: 'xqc', stream: { streamId: 's1', vodId: '123456' }, vodArtwork: artwork } })
  })
  await page.goto('/analytics/moments')
  await expect(page.locator('.moments-result')).toHaveCount(2)
  expect(checks).toBe(0)
  await expect(page.locator('.moments-card-artwork')).toHaveCount(0)
  await page.locator('.moments-result').first().getByRole('button', { name: 'Open moment' }).click()
  await expect(page.getByRole('link', { name: /^Open VOD at/ })).toBeVisible()
  // Dev StrictMode may abort/re-run selection effects. Gallery navigation must
  // issue zero additional requests relative to the completed selected review.
  const selectedChecks = checks
  expect(selectedChecks).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Back to results' }).click()
  await expect(page.locator('.moments-card-artwork')).toHaveCount(1)
  await expect(page.locator('.moments-result').first().locator('.moments-card-artwork img')).toHaveAttribute('src', artwork.url)
  await expect(page.locator('.moments-result').nth(1).locator('.moments-card-artwork')).toHaveCount(0)
  expect(checks).toBe(selectedChecks)
  await page.locator('.moments-result').first().getByRole('button', { name: 'Twitch emote spike — Open moment for xQc at 2:00 into broadcast', exact: true }).click()
  await expect(page.getByRole('link', { name: /^Open VOD at/ })).toHaveAttribute('href', 'https://www.twitch.tv/videos/123456?t=120s')
  expect(checks).toBeGreaterThan(selectedChecks)
})

test('recent hub artwork is display-only, request-free per card, and suppressed by newer source state', async ({ page }) => {
  const artwork = { vodId: '123456', kind: 'archive_thumbnail', url: 'https://static-cdn.jtvnw.net/cf_vods/fixture/thumb/recent.jpg' }
  let sourceChecks = 0
  await installHubUxMock(page, { firstMomentArchiveArtwork: artwork })
  await page.route(artwork.url, route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#222"/></svg>' }))
  await page.route(/\/v1\/portal\/analytics\/streams\/s1(?:\?.*)?$/, route => {
    sourceChecks++
    return route.fulfill({ json: { channel: 'xqc', stream: { streamId: 's1' }, availability: { vodState: 'unavailable' } } })
  })
  await page.goto('/analytics/moments')
  const first = page.locator('.moments-result').first()
  await expect(first.locator('.moments-card-artwork img')).toHaveAttribute('src', artwork.url)
  await expect(first.locator('.moments-card-artwork img')).toHaveAttribute('loading', 'lazy')
  await expect(first.locator('.moments-row-emotes')).toHaveCount(1)
  await expect(page.locator('.moments-result').nth(1).locator('.moments-card-artwork')).toHaveCount(0)
  await expect(page.locator('.moments-result').nth(1)).toContainText('Chat spike')
  await expect(first.locator('.moments-card-artwork').getByRole('button')).toHaveCount(0)
  expect(sourceChecks).toBe(0)
  await first.getByRole('button', { name: 'Save', exact: true }).click()
  expect(await page.evaluate(() => localStorage.getItem('streampulse.saved-moments.v2'))).not.toContain(artwork.url)
  expect(sourceChecks).toBe(0)
  const artworkBounds = await first.locator('.moments-card-artwork').boundingBox()
  expect(artworkBounds).not.toBeNull()
  await page.mouse.click(artworkBounds!.x + artworkBounds!.width / 2, artworkBounds!.y + artworkBounds!.height / 2)
  await expect(page.getByText('archive unavailable', { exact: false })).toBeVisible()
  expect(sourceChecks).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Back to results' }).click()
  await expect(first.locator('.moments-card-artwork')).toHaveCount(0)
})

test('moment cards keep background, keyboard, Save, analytics, and emote interactions independent', async ({ page }) => {
  await page.goto('/analytics/moments')
  const first = page.locator('.moments-result').first()
  await expect(first).toHaveAttribute('aria-label', 'xQc Twitch emote spike at 2:00 into broadcast')
  // One row shape in every state: the measured rates and the emote strip are
  // always the row's evidence, and a row never embeds a player.
  await expect(first.locator('.moments-result-evidence')).toContainText('chat/min')
  await expect(first.locator('iframe')).toHaveCount(0)
  const primary = first.getByRole('button', { name: 'Twitch emote spike — Open moment for xQc at 2:00 into broadcast', exact: true })
  await expect(primary).toContainText('Twitch emote spike')
  await expect(first.locator('.moments-result-timing')).toContainText('2:00 into broadcast')
  await expect(primary).not.toHaveAttribute('aria-pressed')
  await expect(first.locator('.moments-row-emotes')).toHaveCount(1)
  const emote = first.locator('.moments-row-emotes > span').first()
  await emote.hover()
  await expect(emote).toHaveAttribute('title', /DinoDance/)
  await emote.click()
  await expect(page.locator('.moments-detail')).toBeVisible()
  await expect(primary).toHaveAttribute('aria-current', 'true')
  await expect(first.locator('.moments-row-emotes')).toHaveCount(1)
  await page.getByRole('button', { name: 'Back to results' }).click()

  await first.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.moments-detail')).toHaveCount(0)

  const evidence = await first.locator('.moments-result-evidence').boundingBox()
  expect(evidence).not.toBeNull()
  await page.mouse.click(evidence!.x + evidence!.width / 2, evidence!.y + evidence!.height / 2)
  await expect(page.locator('.moments-detail')).toBeVisible()
  await page.getByRole('button', { name: 'Back to results' }).click()

  await primary.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.moments-detail')).toBeVisible()
  await page.getByRole('button', { name: 'Back to results' }).click()
  await primary.focus()
  await page.keyboard.press('Space')
  await expect(page.locator('.moments-detail')).toBeVisible()
  await page.getByRole('button', { name: 'Back to results' }).click()

  const analytics = first.getByRole('link', { name: /^Stream analytics/ })
  await expect(analytics).toHaveAttribute('href', '/analytics/xqc/s1#t=120')
  await analytics.click()
  await expect(page).toHaveURL(/\/analytics\/xqc\/s1#t=120$/)
})

test('cached recent moments render immediately, then converge to the healthy refresh', async ({ page }) => {
  await page.goto('/analytics/moments')
  await expect(page.locator('.moments-result')).toHaveCount(2)
  const cacheState = await page.evaluate(() => Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter((key): key is string => Boolean(key?.startsWith('sp:publicHubProjection:v1:'))).map(key => ({ key, value: JSON.parse(localStorage.getItem(key) || '{}') })))
  expect(cacheState, JSON.stringify(cacheState)).not.toHaveLength(0)
  await installHubUxMock(page, { mode: 'empty', hubDelayMs: 700 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText('No available moments.')).toHaveCount(0, { timeout: 500 })
  await expect(page.locator('.moments-result')).toHaveCount(2, { timeout: 500 })
  await expect(page.getByText('No available moments.')).toBeVisible({ timeout: 3_000 })
  await expect(page.locator('.moments-result')).toHaveCount(0)
})

test('unavailable exact source remains saveable and recovery does not substitute another stream', async ({ page }) => {
  let available = false
  await page.route('**/v1/portal/analytics/streams/*', route => route.fulfill({ json: { vodTiming: { state: 'verified' }, vodDurationSeconds: 18000, vodAlignSeconds: 0, channel: 'xqc', stream: { streamId: available ? 's1' : 'other', vodId: '123456' } } }))
  await page.goto('/analytics/moments?login=xqc&stream=s1&offset=9999')
  await expect(page.getByText('Saved metadata is historical.', { exact: false })).toHaveCount(0)
  await expect(page.getByText('Source identity could not be confirmed. No substitute stream was selected.')).toBeVisible()
  await expect(page.getByRole('link', { name: /^Open VOD at/ })).toHaveCount(0)
  await page.locator('.moments-detail').getByRole('button', { name: 'Save', exact: true }).click()
  available = true
  await page.locator('.moments-detail').getByRole('button', { name: 'Recheck source' }).click()
  await expect(page.getByRole('link', { name: /^Open VOD at/ })).toHaveAttribute('href', 'https://www.twitch.tv/videos/123456?t=9999s')
  await page.getByRole('tab', { name: 'Saved (1)', exact: true }).click()
  await page.locator('.moments-result').getByRole('button', { name: 'Saved', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Find moments to save' })).toBeVisible()
})

test('loaded search and ordering survive exact-detail Back and refresh', async ({ page }) => {
  await page.goto('/analytics/moments')
  await page.getByRole('combobox', { name: 'Sort loaded results', exact: true }).click()
  await page.getByRole('option', { name: 'Category A–Z', exact: true }).click()
  await page.getByLabel('Find loaded moments').fill('xqc')
  await expect(page.locator('.moments-result')).toHaveCount(1)
  await expect(page.getByText('For earlier broadcasts, open History.', { exact: false })).toBeVisible()
  await page.locator('.moments-result').getByRole('button', { name: 'Open moment' }).click()
  await expect(page.getByRole('link', { name: /^Open VOD at/ })).toHaveAttribute('href', 'https://www.twitch.tv/videos/123456?t=120s')
  await page.goBack()
  await expect(page.getByLabel('Find loaded moments')).toHaveValue('xqc')
  await expect(page.locator('.moments-result').getByRole('button', { name: 'Open moment' })).toBeFocused()
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Sort loaded results', exact: true })).toHaveText('Category A–Z')
  await expect(page.locator('.moments-result')).toHaveCount(1)
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(page.getByLabel('Find loaded moments')).toHaveValue('')
  await expect(page.getByRole('combobox', { name: 'Sort loaded results', exact: true })).toHaveText('Newest first')
  await expect(page.locator('.moments-result')).toHaveCount(2)
})

test('selected verified preview stays unloaded until asked, then plays without autoplay and retains close/mobile controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  let playerRequests = 0
  await page.route('https://player.twitch.tv/**', route => {
    playerRequests += 1
    return route.fulfill({ contentType: 'text/html', body: '<p>Player contract fixture</p>' })
  })
  await page.goto('/analytics/moments?login=xqc&stream=s1&offset=120')
  const frame = page.getByTitle('Selected moment Twitch VOD preview')

  // Selecting a result must not create player traffic.
  await expect(page.getByRole('button', { name: /Load Twitch preview/ })).toBeVisible()
  await expect(frame).toHaveCount(0)
  await expect(page.locator('.moments-detail h2')).toBeFocused()
  expect(playerRequests).toBe(0)

  await page.getByRole('button', { name: /Load Twitch preview/ }).click()
  await expect(frame).toHaveAttribute('src', /video=v123456&time=120s&parent=127.0.0.1&autoplay=false/)
  // A matching src alone passed while the document CSP blocked every real preview.
  await expect(page.frameLocator('iframe[title="Selected moment Twitch VOD preview"]').getByText('Player contract fixture')).toBeVisible()
  expect(playerRequests).toBeGreaterThan(0)
  await expect(page.getByRole('link', { name: 'Open on Twitch' })).toHaveAttribute('href', 'https://www.twitch.tv/videos/123456?t=120s')
  await page.getByRole('button', { name: 'Close preview', exact: true }).click()
  await expect(page.getByRole('button', { name: /Load Twitch preview/ })).toBeFocused()
  await expect(frame).toHaveCount(0)
  await page.getByRole('button', { name: /Load Twitch preview/ }).click()
  await expect(frame).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Close preview', exact: true })).toBeFocused()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(frame).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Watch on Twitch at 2:00' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Watch on Twitch at 2:00' })).toBeFocused()
  const mobileTargets = page.locator('.moment-vod-preview__fallback a, .moments-detail summary')
  expect(await mobileTargets.count()).toBeGreaterThan(1)
  for (const target of await mobileTargets.all()) {
    expect((await target.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  }
})

for (const width of [390, 768, 1440]) {
  test(`flat workspace fits ${width}px with readable detail`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    await page.goto('/analytics/moments')
    await expect(page.locator('.moments-result')).toHaveCount(2)
    await page.screenshot({ path: info.outputPath(`moments-${width}.png`), fullPage: true })
    await page.locator('.moments-result').first().getByRole('button', { name: 'Open moment' }).click()
    await expect(page.getByRole('link', { name: /^Open VOD at/ })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    if (width <= 768) {
      const geometry = await page.evaluate(() => {
        const header = document.querySelector('.analytics-topnav')!.getBoundingClientRect()
        const controls = ['.moments-back', '.moments-review-navigation', '.moments-detail h2'].map(selector => {
          const bounds = document.querySelector(selector)!.getBoundingClientRect()
          return { selector, top: bounds.top, bottom: bounds.bottom }
        })
        return { headerBottom: header.bottom, height: innerHeight, controls }
      })
      for (const control of geometry.controls) {
        expect(control.top, JSON.stringify(geometry)).toBeGreaterThanOrEqual(geometry.headerBottom)
        expect(control.bottom, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.height)
      }
      await expect(page.locator('.moments-detail h2')).toBeFocused()
    }
    await page.screenshot({ path: info.outputPath(`detail-viewport-${width}.png`) })
    await page.screenshot({ path: info.outputPath(`detail-${width}.png`), fullPage: true })
  })
}
