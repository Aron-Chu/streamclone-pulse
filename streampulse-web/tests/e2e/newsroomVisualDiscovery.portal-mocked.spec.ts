import { expect, test, type Page } from '@playwright/test'
import { attachConsoleErrorGuard, assertNoConsoleErrors, assertNoPageHorizontalOverflow } from './helpers/assertions'
import { installHubUxMock } from './helpers/hubUxMock'

const profileRequests = new Set<string>()
const fixtureAt = Math.floor(Date.now() / 60_000) * 60_000

function longCreatorEnvelope() {
  const evidence = {
    ircBound: true,
    eventRollupAvailable: true,
    streamIdentityMatched: true,
    rollupChatSource: 'irc',
    rollupSourceConfidence: 'verified',
    rollupSourceDetail: 'closed minute IRC rollup',
    metadataStreamMatched: true,
    metadataSampledAt: fixtureAt - 30_000,
    baselineMeasuredMinutes: 24,
    baselineExpectedMinutes: 24,
    baselineCoveragePct: 100,
  }
  const metric = {
    state: 'ready',
    currentPerMin: 133,
    baselinePerMin: 32,
    absoluteDeltaPerMin: 101,
    changePct: 315.6,
    multiplier: 4.2,
    currentMeasuredMinutes: 1,
    currentExpectedMinutes: 1,
    baselineMeasuredMinutes: 24,
    baselineExpectedMinutes: 24,
    baselineCoveragePct: 100,
  }
  const story = {
    id: 'story-happyhappygal',
    login: 'happyhappygal',
    displayName: 'HappyHappyGal',
    category: 'Fortnite',
    streamId: 'stream-happyhappygal',
    lifecycle: 'confirmed',
    primarySignal: 'emotes',
    headline: 'HappyHappyGal: Emote spike',
    summary: 'A measured creator moment is holding above the earlier stream baseline.',
    revision: 2,
    createdAt: new Date(fixtureAt - 5 * 60_000).toISOString(),
    lastPublishedAt: new Date(fixtureAt).toISOString(),
    leadUpdate: {
      id: 'update-happyhappygal',
      revision: 2,
      detectorEventKey: 'episode-happyhappygal',
      updateKind: 'lifecycle',
      occurredAt: new Date(fixtureAt).toISOString(),
      publishedAt: new Date(fixtureAt + 1_000).toISOString(),
      signal: 'emotes',
      lifecycle: 'confirmed',
      headline: 'HappyHappyGal: Emote spike',
      summary: 'Measured emote activity remains above this stream’s earlier baseline.',
      comparison: {
        baselineKind: 'current_stream_measured_average_before_event',
        eventAt: fixtureAt,
        baselineWindow: {
          start: fixtureAt - 24 * 60_000,
          end: fixtureAt,
          expectedMinutes: 24,
          measuredMinutes: 24,
          coveragePct: 100,
        },
        chat: { ...metric, currentPerMin: 80 },
        emotes: metric,
        evidence,
      },
      evidence,
      topEmotes: [{ name: 'DinoDance', provider: '7TV', count: 80, sharePct: 0 }],
      momentRef: {
        publicMomentId: 'moment-happyhappygal',
        streamId: 'stream-happyhappygal',
        occurrenceAt: fixtureAt,
        offsetSeconds: 240,
      },
      notificationEligible: true,
      isLate: false,
      sparkline: [
        { at: fixtureAt - 120_000, currentPerMin: 32, baselinePerMin: 32 },
        { at: fixtureAt - 60_000, currentPerMin: 78, baselinePerMin: 32 },
        { at: fixtureAt, currentPerMin: 133, baselinePerMin: 32 },
      ],
    },
  }
  // Multiple creators exercise long names and measured-emote fallbacks without
  // implying that these fixtures are live evidence.
  const moreStories = ['lirik', 'maya', 'ironmouse', 'stableronaldo', 'arky'].map((login, index) => ({
    ...story,
    id: `story-${login}`,
    login,
    displayName: login === 'stableronaldo' ? 'StableRonaldoWithALongDisplayName' : login,
    streamId: `stream-${login}`,
    headline: `${login}: ${index % 2 === 0 ? 'Emote reaction' : 'Chat activity'}`,
    primarySignal: index % 2 === 0 ? 'emotes' : 'chat',
    leadUpdate: {
      ...story.leadUpdate,
      id: `update-${login}`,
      detectorEventKey: `episode-${login}`,
      headline: `${login}: ${index % 2 === 0 ? 'Emote reaction' : 'Chat activity'}`,
      signal: index % 2 === 0 ? 'emotes' : 'chat',
      sparkline: index % 2 === 0 ? [] : story.leadUpdate.sparkline,
      momentRef: {
        ...story.leadUpdate.momentRef,
        publicMomentId: `moment-${login}`,
        streamId: `stream-${login}`,
      },
    },
  }))
  return {
    schemaVersion: 1,
    status: 'ready',
    generatedAt: new Date(fixtureAt + 2_000).toISOString(),
    dataThrough: new Date(fixtureAt).toISOString(),
    snapshotAt: new Date(fixtureAt + 2_000).toISOString(),
    window: 'live',
    leadStoryId: story.id,
    // Contract order: newest publication, then descending ID for equal times.
    stories: [story, ...moreStories].sort((a, b) => a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    networkBrief: {
      currentStart: new Date(fixtureAt - 30 * 60_000).toISOString(),
      currentEnd: new Date(fixtureAt).toISOString(),
      baselineStart: new Date(fixtureAt - 60 * 60_000).toISOString(),
      baselineEnd: new Date(fixtureAt - 30 * 60_000).toISOString(),
      comparableChannels: 42,
      coveragePct: 96,
      chatChangePct: 18,
      emoteChangePct: 31,
    },
  }
}

async function installVisualDiscovery(page: Page) {
  profileRequests.clear()
  await installHubUxMock(page)
  const fixture = longCreatorEnvelope()
  const broadcasts = fixture.stories.map((story, index) => {
    const score = 94 - index * 8
    const strongestMoment = { ...story.leadUpdate, score }
    return {
      id: `pulse-${story.login}-session`, login: story.login, displayName: story.displayName,
      profileImageUrl: `https://static-cdn.jtvnw.net/jtv_user_pictures/${story.login}-profile.png`,
      category: story.category, streamId: story.streamId, state: 'live',
      primarySignal: story.primarySignal, momentCount: 1, strongestScore: score,
      firstActivityAt: strongestMoment.occurredAt, lastActivityAt: strongestMoment.occurredAt,
      strongestMoment, latestMoment: strongestMoment, sources: [],
    }
  })
  await page.route(/\/v1\/public\/explorer(?:\/[^?]+)?(?:\?.*)?$/, async route => {
    const url = new URL(route.request().url())
    const id = url.pathname.split('/explorer/')[1]
    const broadcast = id ? broadcasts.find(item => item.id === id) : undefined
    const window = url.searchParams.get('window') || 'live'
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 1, status: 'ready', generatedAt: fixture.generatedAt, dataThrough: fixture.dataThrough,
      window, query: { window, signal: 'all', state: 'all', sort: 'strongest' },
      summary: { broadcastCount: broadcasts.length, momentCount: broadcasts.length, categoryCount: new Set(broadcasts.map(item => item.category)).size },
      facets: { signals: [], categories: [], states: [] },
      broadcasts: id ? [] : broadcasts, networkContext: fixture.networkBrief,
      ...(broadcast ? { broadcast, moments: [broadcast.strongestMoment] } : {}),
    }) })
  })
  await page.route('https://static-cdn.jtvnw.net/jtv_user_pictures/*-profile.png', async (route) => {
    profileRequests.add(new URL(route.request().url()).pathname.split('/').pop()!.replace(/-profile\.png$/, ''))
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="48" fill="#8b5cf6"/><circle cx="48" cy="36" r="18" fill="#f4f4f7"/><path d="M18 88c4-20 17-30 30-30s26 10 30 30" fill="#f4f4f7"/></svg>',
    })
  })
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 360, height: 900 }]) {
  test('Explorer keeps creator imagery, evidence, and clear layout at ' + viewport.width + 'px', async ({ page }, testInfo) => {
    const errors = attachConsoleErrorGuard(page)
    await page.setViewportSize(viewport)
    await installVisualDiscovery(page)
    await page.goto('/analytics/newsroom')
    await expect(page).toHaveURL('/analytics/explore')

    const explorer = page.getByRole('main', { name: 'Pulse Explorer' })
    await expect(explorer.getByRole('heading', { name: 'Pulse Explorer' })).toBeVisible()
    await expect(page.locator('.newsroom-lead, .newsroom-sparkline')).toHaveCount(0)
    const results = page.locator('.explorer-result')
    await expect(results).toHaveCount(6)
    const creator = results.filter({ hasText: 'HappyHappyGal' })
    const longName = results.filter({ hasText: 'StableRonaldoWithALongDisplayName' })
    await expect(creator).toBeVisible()
    await expect(longName).toBeVisible()
    await expect(longName).toContainText('StableRonaldoWithALongDisplayName')
    const avatar = creator.getByRole('img', { name: 'HappyHappyGal avatar' })
    await expect(avatar).toBeVisible()
    await expect.poll(() => avatar.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
    expect(profileRequests.has('happyhappygal')).toBe(true)
    const visual = await creator.evaluate(card => {
      const image = card.querySelector('img')?.getBoundingClientRect()
      const name = card.querySelector('.explorer-result__identity strong')?.getBoundingClientRect()
      const bounds = card.getBoundingClientRect()
      return {
        imageContained: Boolean(image && image.left >= bounds.left && image.right <= bounds.right),
        textContained: Boolean(name && name.left >= bounds.left && name.right <= bounds.right),
        imageOverlapsName: Boolean(image && name && image.left < name.right && image.right > name.left && image.top < name.bottom && image.bottom > name.top),
        backgroundImage: getComputedStyle(card).backgroundImage,
      }
    })
    expect(visual.imageContained).toBe(true)
    expect(visual.textContained).toBe(true)
    expect(visual.imageOverlapsName).toBe(false)
    expect(visual.backgroundImage).toBe('none')
    await expect(page.getByRole('region', { name: 'Network context' })).toContainText('42')

    await creator.click()
    await expect(page).toHaveURL('/analytics/explore/pulse-happyhappygal-session')
    const inspector = page.getByRole('complementary', { name: 'Selected broadcast inspector' })
    await expect(inspector.getByRole('heading', { name: 'HappyHappyGal', exact: true })).toBeVisible()
    await expect(inspector.getByLabel('Top emotes')).toContainText('DinoDance')
    await expect(inspector.getByText(/not enough measured points/i)).toBeVisible()
    await expect(inspector.getByRole('img', { name: /reaction score trend/i })).toHaveCount(0)
    await assertNoPageHorizontalOverflow(page)
    await assertNoConsoleErrors(page, errors)
    await page.screenshot({ path: testInfo.outputPath('explorer-creators-' + viewport.width + '.png'), fullPage: true })
  })
}

test('mobile Explorer keeps measured emote names readable with image fallback', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await installVisualDiscovery(page)
  await page.goto('/analytics/newsroom/pulse-happyhappygal-session')
  await expect(page).toHaveURL('/analytics/explore/pulse-happyhappygal-session')
  const inspector = page.getByRole('complementary', { name: 'Selected broadcast inspector' })
  const emotes = inspector.getByLabel('Top emotes')
  await expect(emotes).toContainText('DinoDance')
  const name = emotes.getByText('DinoDance')
  const box = await name.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThan(40)
  expect(box!.height).toBeLessThan(50)
  expect(await name.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await expect(emotes.locator('.explorer-emote__fallback')).toBeVisible()
  await assertNoPageHorizontalOverflow(page)
  await emotes.screenshot({ path: testInfo.outputPath('explorer-mobile-emote-evidence.png') })
})

test('independent Live Wire keeps creator imagery without duplicating the Newsroom board', async ({ page }) => {
  await installVisualDiscovery(page)
  await page.goto('/analytics')
  const rail = page.locator('.analytics-discovery-layout__wire')
  await expect(rail.locator('.hub-live-wire')).toHaveCount(1)
  await expect(rail.locator('.newsroom-lead--compact')).toHaveCount(0)
  await expect(rail.locator('.newsroom-lead--feature, .newsroom-lead--tile, .newsroom-sparkline')).toHaveCount(0)
  const avatar = rail.locator('.hub-live-wire__rail-av img').first()
  await expect(avatar).toBeVisible()
  await expect.poll(() => avatar.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
  const surface = await rail.evaluate(element => ({ background: getComputedStyle(element).backgroundImage, overflow: getComputedStyle(element).overflowY }))
  expect(surface.background).toBe('none')
  expect(surface.overflow).not.toMatch(/auto|scroll/)
})
