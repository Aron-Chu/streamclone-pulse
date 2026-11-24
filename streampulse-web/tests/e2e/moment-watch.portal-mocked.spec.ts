import { expect, test, type Page } from './helpers/portalMockedTest'
import {
  CATEGORY_ID, CHANNEL, GAME, GAME_ART_URL, NEARBY_CLIP, OFFSET_SECONDS, OTHER_VOD_CLIP, PAGE_PATH, STREAM_ID, TITLE,
  VOD_ID, VOD_THUMBNAIL_URL, openFromHub, serveMomentWatch, switchOn,
} from './helpers/momentWatchMock'

/**
 * A Moment's own page, /analytics/moments/:streamId/:momentAt, read-only: the build has
 * VITE_PUBLIC_MOMENT_PAGE on and VITE_PUBLIC_MOMENT_FEEDBACK off. The page reads public data only
 * (the stream route, its recap, the minutes, the picture reads) and never a /v1/account/... route.
 * Ratings and comments are moment-watch-feedback.portal-mocked.spec.ts. Every name, id and emote is made up.
 */

const pageOn = switchOn('VITE_PUBLIC_MOMENT_PAGE')
const feedbackOn = switchOn('VITE_PUBLIC_MOMENT_FEEDBACK')

const watchLink = (page: Page, at: string) => page.getByRole('link', { name: `Watch on Twitch from ${at}` })
const vodHref = (seconds: number) => `https://www.twitch.tv/videos/${VOD_ID}?t=${seconds}s`
const pictureLabel = (page: Page) => page.locator('.mw-picture .mw-picture-label')

test.describe('Moment page, read-only', () => {
  // To run these, build and run with VITE_PUBLIC_MOMENT_PAGE=1 exported and VITE_PUBLIC_MOMENT_FEEDBACK unset.
  test.skip(!pageOn || feedbackOn, 'needs a build with VITE_PUBLIC_MOMENT_PAGE on and VITE_PUBLIC_MOMENT_FEEDBACK off')

  test('the head comes from public data: no rating, no comments, no second picker, no clip claim', async ({ page }) => {
    // The feedback route answers 404 here: a call to it would be counted, and none may come.
    const served = await serveMomentWatch(page, { feedbackStatus: 404 })
    await page.goto(PAGE_PATH)
    await expect(page).toHaveTitle(TITLE)
    await expect(page.getByRole('heading', { level: 1, name: 'Moment at 0:40:00' })).toBeVisible()
    await expect(watchLink(page, '0:40:00')).toHaveAttribute('href', vodHref(OFFSET_SECONDS))
    await expect(page.getByRole('link', { name: CHANNEL, exact: true })).toHaveAttribute('href', '/analytics/fakechan01')
    await expect(page.getByText(GAME, { exact: true })).toBeVisible()
    // Opened from an address (no hand-over): the way back is the list.
    await expect(page.locator('main').getByRole('link', { name: 'All Moments', exact: true })).toHaveAttribute('href', '/analytics/moments')
    // The P1 picture: the stream's own frame at the middle of the minute, labelled.
    await expect(page.locator('.mw-picture [data-kind="frame"]')).toBeVisible()
    await expect(pictureLabel(page)).toHaveAttribute('title', 'Stream frame from this moment')
    await expect(pictureLabel(page)).toContainText('Stream frame')
    await expect(page.getByText('No other Moments from this stream yet.')).toBeVisible()

    await expect(page.getByText('Real moment?')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Yes' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: /^\d+ comments?$/ })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Your comment' })).toHaveCount(0)
    await expect(page.getByRole('slider', { name: 'Second in the stream' })).toHaveCount(0)
    await expect(page.getByText('No clip of this one yet.')).toHaveCount(0)
    await expect(page.getByText('Moment pages aren’t switched on yet')).toHaveCount(0)
    expect(served.feedbackCalls).toBe(0)
    expect(served.accountCalls).toEqual([])
    expect(served.feedCalls).toEqual([])
    // One stream read and one recap read for the whole page (the facts, the Twitch link, the dropped check and Up next share them).
    expect(served.streamCalls).toBe(1)
    expect(served.recapCalls).toBe(1)
    // The frame is asked at the middle of the minute on the VOD's clock: 2400 + 30.
    expect(served.frameCalls).toEqual(['2430'])
    expect(served.unmatched).toEqual([])
  })

  test('no frame: a clip from the same broadcast within 45 s is the picture, never one from another broadcast', async ({ page }) => {
    const served = await serveMomentWatch(page, { frame: false, clips: [OTHER_VOD_CLIP, NEARBY_CLIP] })
    await page.goto(PAGE_PATH)
    const box = page.locator('.mw-picture [data-kind="clip"]')
    await expect(box).toBeVisible()
    await expect(box.locator('img')).toHaveAttribute('src', NEARBY_CLIP.thumbnailUrl)
    await expect(pictureLabel(page)).toHaveAttribute('title', 'Nearby clip from the same stream, 10 s from the moment')
    await expect(pictureLabel(page)).toContainText('Nearby clip')
    // Still read-only: a nearby clip is a picture, not the Moment's clip.
    await expect(page.getByRole('heading', { level: 1, name: 'Moment at 0:40:00' })).toBeVisible()
    await expect(page.getByText('No clip of this one yet.')).toHaveCount(0)
    // One clips read for the channel per page view.
    expect(served.clipCalls).toHaveLength(1)
    expect(served.feedbackCalls).toBe(0)
    expect(served.unmatched).toEqual([])
  })

  test('no frame and no nearby clip: the stream’s VOD thumbnail comes before the game art, labelled as not this moment', async ({ page }) => {
    const served = await serveMomentWatch(page, { frame: false, clips: [OTHER_VOD_CLIP], vodThumbnail: true, categoryId: CATEGORY_ID })
    await page.goto(PAGE_PATH)
    await expect(page.locator('.mw-picture .nc-thumb img')).toHaveAttribute('src', VOD_THUMBNAIL_URL)
    await expect(pictureLabel(page)).toHaveAttribute('title', 'The stream’s thumbnail, not this moment')
    await expect(pictureLabel(page)).toContainText('VOD thumbnail')
    await expect(page.locator('.mw-picture [data-kind="game"]')).toHaveCount(0)
    expect(served.feedbackCalls).toBe(0)
    expect(served.unmatched).toEqual([])
  })

  test('no frame, clip or VOD thumbnail: the game art, labelled as not this moment', async ({ page }) => {
    const served = await serveMomentWatch(page, { frame: false, clips: [OTHER_VOD_CLIP], categoryId: CATEGORY_ID })
    await page.goto(PAGE_PATH)
    const box = page.locator('.mw-picture [data-kind="game"]')
    await expect(box).toBeVisible()
    await expect(box.locator('img')).toHaveAttribute('src', GAME_ART_URL)
    await expect(pictureLabel(page)).toHaveAttribute('title', `Game art for ${GAME}, not this moment`)
    await expect(pictureLabel(page)).toContainText('Game art')
    // The game at the Moment's minute comes from the stream's game segments, read once.
    expect(served.gamesCalls).toBe(1)
    expect(served.feedbackCalls).toBe(0)
    expect(served.unmatched).toEqual([])
  })

  test('no picture at all: the box says so, and claims nothing about clips', async ({ page }) => {
    const served = await serveMomentWatch(page, { frame: false })
    await page.goto(PAGE_PATH)
    await expect(page.locator('.mw-picture').getByText('No picture of this moment yet')).toBeVisible()
    await expect(page.getByText('No clip of this one yet.')).toHaveCount(0)
    await expect(pictureLabel(page)).toHaveCount(0)
    await expect(watchLink(page, '0:40:00')).toHaveAttribute('href', vodHref(OFFSET_SECONDS))
    expect(served.feedbackCalls).toBe(0)
    expect(served.unmatched).toEqual([])
  })

  test('a minute the recap no longer lists says so, without promising ratings or comments, when the link called it a top Moment', async ({ page }) => {
    const served = await serveMomentWatch(page, { recapOffsets: [] })
    // A bare address never called the minute a top Moment: no note.
    await page.goto(PAGE_PATH)
    await expect(page.getByRole('heading', { level: 1, name: 'Moment at 0:40:00' })).toBeVisible()
    await expect(page.getByText('No other Moments from this stream yet.')).toBeVisible()
    await expect(page.getByRole('note')).toHaveCount(0)
    // The hub's link did.
    await openFromHub(page)
    await expect(page.getByRole('note')).toHaveText(`This minute is no longer among ${CHANNEL}’s top Moments.`)
    await expect(page.getByText('No other Moments from this stream yet.')).toBeVisible()
    expect(served.feedbackCalls).toBe(0)
    expect(served.unmatched).toEqual([])
  })

  test('a live Moment with the Moments feed switch off reads the recap and never /v1/public/moments', async ({ page }) => {
    // The build under test leaves VITE_PUBLIC_MOMENTS_FEED unset, so momentsFeedEnabled() is false.
    const served = await serveMomentWatch(page, { ended: false, recapOffsets: [OFFSET_SECONDS, 3000] })
    await page.goto(PAGE_PATH)
    await expect(page.getByRole('heading', { level: 1, name: 'Moment at 0:40:00' })).toBeVisible()
    // Up next comes from the recap while live too.
    await expect(page.getByRole('complementary').getByRole('link', { name: /^Moment at 0:50:00/ })).toBeVisible()
    // Live with the feed off, the page cannot tell whether the minute dropped: no note.
    await expect(page.getByRole('note')).toHaveCount(0)
    expect(served.feedCalls).toEqual([])
    expect(served.recapCalls).toBe(1)
    expect(served.feedbackCalls).toBe(0)
    expect(served.unmatched).toEqual([])
  })

  test('a minute outside the stream is not here', async ({ page }) => {
    // 22:00 is after the stream ended at 21:00.
    const served = await serveMomentWatch(page)
    await page.goto(`/analytics/moments/${STREAM_ID}/20261110T2200Z`)
    await expect(page.getByText('This Moment isn’t here')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open Moments' })).toHaveAttribute('href', '/analytics/moments')
    expect(served.streamCalls).toBe(1)
    expect(served.feedbackCalls).toBe(0)
    expect(served.unmatched).toEqual([])
  })

  test('an Up next row opens its minute’s page, and Back returns without reading the stream again', async ({ page }) => {
    const served = await serveMomentWatch(page, { recapOffsets: [OFFSET_SECONDS, 3000] })
    await page.goto(PAGE_PATH)
    const row = page.getByRole('complementary').getByRole('link', { name: /^Moment at 0:50:00/ })
    await expect(row).toHaveAttribute('href', `/analytics/moments/${STREAM_ID}/20261110T1850Z`)
    await row.click()
    await expect(page).toHaveURL(new RegExp(`/analytics/moments/${STREAM_ID}/20261110T1850Z$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Moment at 0:50:00' })).toBeVisible()
    await expect(watchLink(page, '0:50:00')).toHaveAttribute('href', vodHref(3000))
    // Opened from a row: Back goes back in history.
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page).toHaveURL(new RegExp(`${PAGE_PATH}$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Moment at 0:40:00' })).toBeVisible()
    expect(served.streamCalls).toBe(1)
    expect(served.recapCalls).toBe(1)
    expect(served.feedbackCalls).toBe(0)
    expect(served.unmatched).toEqual([])
  })

  test('at 390 px wide there is no sideways scroll, and the Watch pill clears the channel name', async ({ page }) => {
    const served = await serveMomentWatch(page, { recapOffsets: [OFFSET_SECONDS, 3000, 3600] })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(PAGE_PATH)
    await expect(page.locator('figure.moment-minutes[data-state="ready"]')).toBeVisible()
    await expect(page.locator('.mw-picture [data-kind="frame"]')).toBeVisible()
    const pill = watchLink(page, '0:40:00').filter({ hasText: 'Watch on Twitch' }).last()
    await expect(pill).toBeVisible()
    await expect(page.getByRole('complementary').getByRole('link', { name: /^Moment at / })).toHaveCount(2)
    const name = page.getByRole('link', { name: CHANNEL, exact: true })
    const [pillBox, nameBox] = await Promise.all([pill.boundingBox(), name.boundingBox()])
    expect(pillBox!.y).toBeGreaterThanOrEqual(nameBox!.y + nameBox!.height - 1)
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }))
    expect(widths.scroll).toBeLessThanOrEqual(widths.inner)
    expect(served.unmatched).toEqual([])
  })

  test('the page’s own rules win over the clip page’s in the built CSS', async ({ page }) => {
    const served = await serveMomentWatch(page, { recapOffsets: [OFFSET_SECONDS, 3000] })
    await page.goto(PAGE_PATH)
    await expect(page.getByRole('complementary').getByRole('link', { name: /^Moment at / }).first()).toBeVisible()
    const styles = await page.evaluate(() => {
      const css = (el: Element | null, prop: string) => el ? getComputedStyle(el).getPropertyValue(prop) : 'missing'
      return {
        channelWrap: css(document.querySelector('.nc-watch-channel'), 'flex-wrap'),
        titleClamp: css(document.querySelector('.mw-up-title'), '-webkit-line-clamp'),
      }
    })
    expect(styles).toEqual({ channelWrap: 'wrap', titleClamp: '2' })
    expect(served.unmatched).toEqual([])
  })
})

test.describe('Moment page switched off', () => {
  // CI's mocked build: VITE_PUBLIC_MOMENT_PAGE unset.
  test.skip(pageOn, 'the build has VITE_PUBLIC_MOMENT_PAGE on')

  test('a Moment address is the 404 page and reads nothing', async ({ page }) => {
    const served = await serveMomentWatch(page)
    await page.goto(PAGE_PATH)
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
    await expect(page).toHaveTitle('Page not found — StreamPulse')
    expect(served.streamCalls).toBe(0)
    expect(served.recapCalls).toBe(0)
    expect(served.accountCalls).toEqual([])
    expect(served.feedCalls).toEqual([])
    expect(served.unmatched).toEqual([])
  })
})
