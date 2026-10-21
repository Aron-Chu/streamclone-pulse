import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel, openTwitchVod } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'

// Signed out, everything here stays on this device: no account routes.

test('History shows a newly watched moment without a reload', async ({ extension, prepare }) => {
  test.setTimeout(30_000)
  await prepare()
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#moments`)
  await page.getByRole('tab', { name: 'Storage & privacy', exact: true }).click()
  await page.getByRole('checkbox', { name: /Remember watched moments/ }).click()
  await expect(page.getByText('Local history enabled.', { exact: false })).toBeVisible()
  const history = page.getByRole('tab', { name: 'History', exact: true })
  await history.click()
  await expect(page.getByText('Clutch round', { exact: true })).toHaveCount(0)
  // A reload would drop this mark.
  await page.evaluate(() => { (window as unknown as { pulseNoReload?: boolean }).pulseNoReload = true })

  // Ten seconds of a Pulse jump watched in a Twitch tab, as the panel reports it.
  const twitch = await extension.context.newPage()
  await openTwitchChannel(twitch)
  const recorded = await extension.serviceWorker.evaluate(async () => {
    const tab = (await chrome.tabs.query({ url: 'https://www.twitch.tv/*' }))[0]
    const [response] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, world: 'ISOLATED', func: async () => {
      const status = await chrome.runtime.sendMessage({ type: 'MOMENT_CAPTURE', action: 'status' })
      return chrome.runtime.sendMessage({ type: 'MOMENT_CAPTURE', action: 'record', epoch: status.epoch, watchedSeconds: 10,
        reference: { id: 'moment', channel: 'fixturechan', title: 'Clutch round', streamId: '123456789', vodId: '2806037629', offsetSeconds: 100, availability: 'unresolved' } })
    } })
    return response.result
  })
  expect(recorded).toEqual({ ok: true })

  // The open page catches up in place: still on History, never reloaded.
  await page.bringToFront()
  await expect(page.getByText('Clutch round', { exact: true })).toBeVisible()
  await expect(history).toHaveAttribute('aria-selected', 'true')
  expect(await page.evaluate(() => (window as unknown as { pulseNoReload?: boolean }).pulseNoReload)).toBe(true)
})

test('Undo puts back a note kept on this device, for two minutes', async ({ extension, prepare }) => {
  test.setTimeout(45_000)
  await prepare({ scenario: 'vod-ready', twitchKind: 'vod', storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } })
  const twitch = extension.page
  await openTwitchVod(twitch)
  await waitForPulseRoot(twitch)
  const root = twitch.locator('#streamclone-pulse-root')
  // A chart minute, as in recap-bookmarks.mocked.spec.ts.
  await root.getByRole('application', { name: /^Chart plot/ }).focus()
  await twitch.keyboard.press('End')
  await twitch.keyboard.press('Enter')
  const save = root.locator('[data-moment-action="bookmark"]')
  const toast = root.locator('.pulse-bookmark-toast')
  await save.click()
  await expect(toast).toContainText('Saved on this device')

  const moments = await extension.context.newPage()
  await moments.goto(`chrome-extension://${extension.extensionId}/options/index.html#moments`)
  await moments.getByText('More', { exact: true }).click()
  await moments.getByRole('button', { name: /^Edit note:/ }).click()
  await moments.getByLabel('Your note').fill('clutch round')
  await moments.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(moments.getByText('clutch round', { exact: true })).toBeVisible()

  const removeThenUndo = async (late: boolean) => {
    await twitch.bringToFront()
    await save.click()
    await expect(toast).toContainText('Removed bookmark at')
    // The worker keeps the note two minutes; move its clock past that.
    if (late) await extension.serviceWorker.evaluate(() => {
      const realNow = Date.now
      Object.assign(globalThis, { pulseRealNow: realNow })
      Date.now = () => realNow() + 121_000
    })
    await toast.locator('[data-bookmark-toast-action="undo"]').click()
    await expect(save).toHaveAttribute('data-moment-save-state', 'saved')
    if (late) await extension.serviceWorker.evaluate(() => { Date.now = (globalThis as unknown as { pulseRealNow: () => number }).pulseRealNow })
    await moments.bringToFront()
    await moments.reload()
    await expect(moments.getByText('1 moment', { exact: true })).toBeVisible()
  }

  await removeThenUndo(false)
  await expect(moments.getByText('clutch round', { exact: true })).toBeVisible()

  // Too late: the bookmark comes back without its note.
  await removeThenUndo(true)
  await expect(moments.getByText('clutch round', { exact: true })).toHaveCount(0)
})
