import { expect, test, type Page } from './helpers/portalMockedTest'
import {
  CHANNEL, EXISTING_COMMENT_IDS, MINUTE_MS, OFFSET_SECONDS, PAGE_PATH, TITLE, VOD_ID, WINDOW, openFromHub, serveMomentWatch, switchOn,
} from './helpers/momentWatchMock'

/**
 * A Moment's own page with ratings and comments: the build has VITE_PUBLIC_MOMENT_PAGE and
 * VITE_PUBLIC_MOMENT_FEEDBACK on. Ratings, the strip's second picker and the comment thread, signed
 * out and signed in. The read-only page is moment-watch.portal-mocked.spec.ts. Every name, id and
 * emote is made up.
 */

const pageOn = switchOn('VITE_PUBLIC_MOMENT_PAGE')
const feedbackOn = switchOn('VITE_PUBLIC_MOMENT_FEEDBACK')

const watchLink = (page: Page, at: string) => page.getByRole('link', { name: `Watch on Twitch from ${at}` })
const vodHref = (seconds: number) => `https://www.twitch.tv/videos/${VOD_ID}?t=${seconds}s`
const thread = (page: Page) => page.getByRole('region', { name: /^\d+ comments?$/ })

test.describe('Moment page with ratings and comments', () => {
  // CI's mocked build leaves both switches off. To run these, build and run with both exported as 1.
  test.skip(!pageOn || !feedbackOn, 'needs a build with VITE_PUBLIC_MOMENT_PAGE and VITE_PUBLIC_MOMENT_FEEDBACK on')

  test('signed out: ratings and comments read, and a Yes press asks to sign in', async ({ page }) => {
    const served = await serveMomentWatch(page)
    await page.goto(PAGE_PATH)
    await expect(page).toHaveTitle(TITLE)
    await expect(page.getByRole('heading', { level: 1, name: 'Moment at 0:40:00' })).toBeVisible()
    await expect(watchLink(page, '0:40:00')).toHaveAttribute('href', vodHref(OFFSET_SECONDS))
    await expect(page.getByText('Real moment?')).toBeVisible()
    await expect(page.getByText('6 said yes', { exact: true })).toBeVisible()
    await expect(thread(page)).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: '2 comments' })).toBeVisible()
    await expect(thread(page).getByText('fake-pog all over chat')).toBeVisible()
    await expect(thread(page).getByText('that was the moment')).toBeVisible()
    await expect(thread(page).getByText('Sign in with Twitch to rate Moments and comment.')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Your comment' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Report' })).toHaveCount(0)
    expect(served.commentQueries[0]?.get('from')).toBe(WINDOW.from)
    expect(served.commentQueries[0]?.get('to')).toBe(WINDOW.to)

    await page.getByRole('button', { name: 'Yes' }).click()
    await expect(page.getByText('Sign in with Twitch to rate or comment.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Sign in with Twitch' }).first()).toHaveAttribute('href', /^\/account\/sign-in/)
    expect(served.feedbackCalls).toBe(1)
    expect(served.ratingCalls).toEqual([])
    expect(served.unmatched).toEqual([])
  })

  test('signed in: rate Yes, then clear it', async ({ page }) => {
    const served = await serveMomentWatch(page, { signedIn: true })
    await page.goto(PAGE_PATH)
    const yes = page.getByRole('button', { name: 'Yes' })
    await expect(yes).toHaveAttribute('aria-pressed', 'false')

    await yes.click()
    await expect(yes).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('7 said yes', { exact: true })).toBeVisible()
    expect(served.ratingCalls).toEqual(['PUT'])

    await yes.click()
    await expect(yes).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByText('6 said yes', { exact: true })).toBeVisible()
    expect(served.ratingCalls).toEqual(['PUT', 'DELETE'])
    expect(served.unmatched).toEqual([])
  })

  test('a comment is pinned to the second picked on the strip and comes first', async ({ page }) => {
    const served = await serveMomentWatch(page, { signedIn: true })
    await page.goto(PAGE_PATH)
    const composer = page.locator('form').filter({ has: page.getByRole('textbox', { name: 'Your comment' }) })
    await expect(composer.getByText('at 0:40:00', { exact: true })).toBeVisible()

    await page.getByRole('slider', { name: 'Second in the stream' }).fill(String(MINUTE_MS + 42_000))
    await expect(composer.getByText('at 0:40:42', { exact: true })).toBeVisible()
    await expect(watchLink(page, '0:40:42')).toHaveAttribute('href', vodHref(2442))

    await page.getByRole('textbox', { name: 'Your comment' }).fill('fake-pog right here')
    await composer.getByRole('button', { name: 'Comment', exact: true }).click()

    const first = thread(page).getByRole('listitem').first()
    await expect(first).toContainText('fake-pog right here')
    await expect(first.getByRole('button', { name: 'at 0:40:42, show on the strip' })).toHaveText('at 0:40:42')
    await expect(first.getByText('(you)')).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: '3 comments' })).toBeVisible()
    expect(served.commentPosts).toEqual([{ at: '2026-11-10T18:40:42Z', body: 'fake-pog right here' }])
    expect(served.unmatched).toEqual([])
  })

  test('report another person’s comment', async ({ page }) => {
    const served = await serveMomentWatch(page, { signedIn: true })
    await page.goto(PAGE_PATH)
    const row = thread(page).getByRole('listitem').filter({ hasText: 'that was the moment' })
    await row.getByRole('button', { name: 'Report' }).click()
    await expect(row.getByRole('group', { name: 'Why report it?' })).toBeVisible()
    await row.getByRole('button', { name: 'Spam' }).click()
    await expect(row.getByText('Reported. Thanks.')).toBeVisible()
    await expect(row.getByRole('button', { name: 'Report' })).toHaveCount(0)
    expect(served.reports).toEqual([{ id: EXISTING_COMMENT_IDS[1], body: { reason: 'spam' } }])
    expect(served.unmatched).toEqual([])
  })

  test('a minute the recap no longer lists says so, when the link called it a top Moment', async ({ page }) => {
    const served = await serveMomentWatch(page, { recapOffsets: [] })
    await openFromHub(page)
    await expect(page.getByRole('note')).toHaveText(`This minute is no longer among ${CHANNEL}’s top Moments. Its ratings and comments stay here.`)
    await expect(thread(page).getByText('fake-pog all over chat')).toBeVisible()
    await expect(page.getByText('No other Moments from this stream yet.')).toBeVisible()
    expect(served.unmatched).toEqual([])
  })

  test('a minute the recap lists has no dropped note', async ({ page }) => {
    const served = await serveMomentWatch(page)
    await openFromHub(page)
    await expect(thread(page).getByText('fake-pog all over chat')).toBeVisible()
    // The page's own checks have settled once the stream's other Moments answer.
    await expect(page.getByText('No other Moments from this stream yet.')).toBeVisible()
    await expect(page.getByRole('note')).toHaveCount(0)
    expect(served.unmatched).toEqual([])
  })

  test('the window listed no clip and there is no picture: the box says there is no clip', async ({ page }) => {
    const served = await serveMomentWatch(page, { frame: false })
    await page.goto(PAGE_PATH)
    await expect(page.getByText('Real moment?')).toBeVisible()
    await expect(page.locator('.mw-picture').getByText('No clip of this one yet.')).toBeVisible()
    await expect(page.locator('.mw-picture .mw-picture-label')).toHaveCount(0)
    expect(served.unmatched).toEqual([])
  })

  test('feedback answering 404 leaves the page read-only', async ({ page }) => {
    const served = await serveMomentWatch(page, { feedbackStatus: 404 })
    await page.goto(PAGE_PATH)
    await expect(page.getByRole('heading', { level: 1, name: 'Moment at 0:40:00' })).toBeVisible()
    await expect(watchLink(page, '0:40:00')).toHaveAttribute('href', vodHref(OFFSET_SECONDS))
    await expect(page.getByText('No other Moments from this stream yet.')).toBeVisible()
    await expect(page.getByText('Moment pages aren’t switched on yet')).toHaveCount(0)
    await expect(page.getByText('Real moment?')).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Your comment' })).toHaveCount(0)
    await expect(page.getByRole('slider', { name: 'Second in the stream' })).toHaveCount(0)
    await expect(page.getByText('No clip of this one yet.')).toHaveCount(0)
    expect(served.feedbackCalls).toBe(1)
    expect(served.unmatched).toEqual([])
  })

  test('at 390 px wide there is no sideways scroll, and the Watch pill clears the channel name', async ({ page }) => {
    const served = await serveMomentWatch(page, { signedIn: true, recapOffsets: [OFFSET_SECONDS, 3000, 3600] })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(PAGE_PATH)
    // Measure only once everything has rendered: the chart, the strip, the thread, the pill and the side list.
    await expect(page.locator('figure.moment-minutes[data-state="ready"]')).toBeVisible()
    await expect(page.getByRole('slider', { name: 'Second in the stream' })).toBeVisible()
    await expect(thread(page).getByText('fake-pog all over chat')).toBeVisible()
    const pill = watchLink(page, '0:40:00').filter({ hasText: 'Watch on Twitch' }).last()
    await expect(pill).toBeVisible()
    const sideRows = page.getByRole('complementary').getByRole('link', { name: /^Moment at / })
    await expect(sideRows).toHaveCount(2)
    const name = page.getByRole('link', { name: CHANNEL, exact: true })
    const [pillBox, nameBox] = await Promise.all([pill.boundingBox(), name.boundingBox()])
    expect(pillBox!.y).toBeGreaterThanOrEqual(nameBox!.y + nameBox!.height - 1)
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }))
    expect(widths.scroll).toBeLessThanOrEqual(widths.inner)
    expect(served.unmatched).toEqual([])
  })

  test('the page’s own rules win over the clip page’s in the built CSS', async ({ page }) => {
    const served = await serveMomentWatch(page, { signedIn: true, recapOffsets: [OFFSET_SECONDS, 3000] })
    await page.goto(PAGE_PATH)
    const row = page.getByRole('complementary').getByRole('link', { name: /^Moment at / }).first()
    await expect(row).toBeVisible()
    const box = page.getByRole('textbox', { name: 'Your comment' })
    await expect(box).toBeVisible()
    const styles = await page.evaluate(() => {
      const css = (el: Element | null, prop: string) => el ? getComputedStyle(el).getPropertyValue(prop) : 'missing'
      return {
        channelWrap: css(document.querySelector('.nc-watch-channel'), 'flex-wrap'),
        boxTop: css(document.querySelector('textarea.nc-add-input'), 'border-top-width'),
        boxBottom: css(document.querySelector('textarea.nc-add-input'), 'border-bottom-width'),
        commentsGap: css(document.querySelector('section.nc-comments'), 'margin-top'),
        titleClamp: css(document.querySelector('.mw-up-title'), '-webkit-line-clamp'),
      }
    })
    expect(styles).toEqual({ channelWrap: 'wrap', boxTop: '0px', boxBottom: '1px', commentsGap: '24px', titleClamp: '2' })
    expect(served.unmatched).toEqual([])
  })

  test('a live Moment with the Moments feed switch off reads no feed at all and shows no dropped note', async ({ page }) => {
    // The build under test leaves VITE_PUBLIC_MOMENTS_FEED unset, so momentsFeedEnabled() is false.
    const served = await serveMomentWatch(page, { ended: false })
    await page.goto(PAGE_PATH)
    await expect(page.getByRole('heading', { level: 1, name: 'Moment at 0:40:00' })).toBeVisible()
    await expect(watchLink(page, '0:40:00')).toBeVisible()
    // Up next reads the recap while the feed is off.
    await expect(page.getByText('No other Moments from this stream yet.')).toBeVisible()
    await expect(page.getByRole('note')).toHaveCount(0)
    expect(served.feedCalls).toEqual([])
    expect(served.unmatched).toEqual([])
  })
})
