import { test, expect } from '../helpers/testFixtures.ts'

/**
 * My Moments' tab bar moves between Bookmarks, History and Storage with the
 * arrow keys, Home and End. Those keys also scroll a page by default, so
 * without preventing that the page jumped to its top or bottom while the tab
 * changed. Packaged options page, real Chromium key handling.
 */
test('the My Moments tab keys change the tab without scrolling the page', async ({ extension, prepare }) => {
  await prepare()
  const page = extension.page
  // Short enough that the page scrolls, with room above and below the tabs.
  await page.setViewportSize({ width: 1280, height: 360 })
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#moments`)
  await expect(page.getByRole('heading', { name: 'My Moments', exact: true })).toBeVisible()
  const tabs = page.getByRole('tablist', { name: 'My Moments views' })
  await expect(tabs.getByRole('tab')).toHaveText(['Bookmarks', 'History', 'Storage & privacy'])
  await page.addStyleTag({ content: 'html { min-height: 4000px; }' })

  /** The window's scroll and every scrolling box around the tabs. */
  const scroll = () => tabs.evaluate(list => {
    const boxes: number[] = []
    for (let box = list.parentElement; box; box = box.parentElement) boxes.push(box.scrollTop, box.scrollLeft)
    return { x: window.scrollX, y: window.scrollY, boxes }
  })
  await tabs.evaluate(list => list.scrollIntoView({ block: 'center' }))
  const before = await scroll()
  const room = await page.evaluate(() => document.scrollingElement!.scrollHeight - window.innerHeight)
  expect(before.y).toBeGreaterThan(0)
  expect(before.y).toBeLessThan(room)

  const selected = tabs.locator('[role="tab"][aria-selected="true"]')
  await selected.focus()
  for (const [key, tab] of [['End', 'Storage & privacy'], ['Home', 'Bookmarks'], ['ArrowRight', 'History'], ['ArrowLeft', 'Bookmarks'], ['ArrowLeft', 'Storage & privacy']] as const) {
    await page.keyboard.press(key)
    await expect(selected).toHaveText(tab)
    await expect(tabs.getByRole('tab', { name: tab, exact: true })).toBeFocused()
    // Two frames: a default scroll would have landed by now.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(await scroll(), `scroll after ${key}`).toEqual(before)
  }
  // Keys the tab bar does not use still scroll the page.
  await page.keyboard.press('PageDown')
  await expect.poll(async () => (await scroll()).y).toBeGreaterThan(before.y)
})
