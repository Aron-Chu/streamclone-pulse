import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

test('packaged My Moments retains notes, separates consent and clears history without bookmarks', async ({extension,prepare}, testInfo) => {
  // Three account links each require a five-second poll cooldown.
  test.setTimeout(45_000)
  await prepare()
  let accountId = '22222222-2222-4222-8222-222222222222'
  let bearer = 'a'.repeat(64)
  let refreshes = 0
  const credentials = () => ({ state: 'approved', accountId, deviceId: '11111111-1111-4111-8111-111111111111', token: bearer, refreshToken: 'b'.repeat(64), expiresAt: new Date(Date.now() + (refreshes ? 3600000 : 30000)).toISOString(), refreshExpiresAt: new Date(Date.now() + 86400000).toISOString() })
  await extension.context.route('https://api.streampulse.stream/v1/account/device-links', route => route.fulfill({ status: 201, json: { pollingSecret: 'd'.repeat(64), code: 'ABCDE-12345', expiresAt: new Date(Date.now() + 600000).toISOString() } }))
  await extension.context.route('https://api.streampulse.stream/v1/account/device-links/poll', route => route.fulfill({ status: 200, json: credentials() }))
  await extension.context.route('https://api.streampulse.stream/v1/account/devices/refresh', async route => {
    expect(route.request().postDataJSON()).toEqual({ refreshToken: 'b'.repeat(64) })
    refreshes++; bearer = 'c'.repeat(64)
    await route.fulfill({ status: 200, json: credentials() })
  })
  await extension.context.route('https://api.streampulse.stream/v1/account/devices/disconnect', async route => {
    expect(route.request().postDataJSON()).toEqual({ token: bearer })
    await route.fulfill({ status: 204 })
  })
  const bookmark = { id:'bookmark-one',login:'fixturechan',streamId:'123456789',vodId:'2806037629',offsetSeconds:100,label:'Saved comeback',notes:'Original note',source:'extension',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString() }
  let items = [bookmark]
  let unavailable = false
  await extension.context.route('https://api.streampulse.stream/v1/pulse/bookmarks**', async route => {
    expect(route.request().headers().authorization).toBe(`Bearer ${bearer}`)
    if (unavailable) { await route.fulfill({ status: 503, json: { error: 'unavailable' } }); return }
    if (route.request().method() === 'DELETE') {
      const id = new URL(route.request().url()).pathname.split('/').at(-1)
      items = items.filter(item => item.id !== id)
      await route.fulfill({ status: 204 })
      return
    }
    if (route.request().method() === 'POST') {
      const input=route.request().postDataJSON()
      const saved={...bookmark,...input,id:'bookmark-two'}
      items.push(saved)
      await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify(saved)})
      return
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items})})
  })
  // PV-1: Preview reads the bookmark's minute from the public minutes route, by stream id and offset, with no credential.
  const minuteReads: string[] = []
  await extension.context.route('https://api.streampulse.stream/v1/portal/analytics/streams/*/minutes**', async route => {
    expect(route.request().headers().authorization).toBeUndefined()
    minuteReads.push(new URL(route.request().url()).pathname + new URL(route.request().url()).search)
    await route.fulfill({ status: 200, json: { streamId: '123456789', channel: 'fixturechan', startedAt: '2026-10-18T21:45:00Z', updatedAt: 1,
      minutes: [{ offsetSeconds: 60, chatCount: 817, totalEmoteCount: 604, viewerAvg: 2941, viewerSamples: 2,
        topEmotes: [{ name: 'forsenCD', provider: '7tv', count: 47 }, { name: 'LOL', provider: 'twitch', count: 224 }, { name: 'LO', provider: 'ffz', count: 113 }] }] } })
  })
  const page=extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#moments`)
  const link = async () => {
    const start = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ACCOUNT', action: 'start' }))
    expect(start.account.state).toBe('pending')
    await expect.poll(async () => {
      const response = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ACCOUNT', action: 'poll' }))
      expect(JSON.stringify(response)).not.toMatch(/token|refreshToken|pollingSecret/)
      return response.account.state
    }, { timeout: 15000, intervals: [1000] }).toBe('linked')
  }
  await expect(page.getByText('Bookmarks are saved on this device', { exact: true })).toBeVisible()
  // Sign-in is compiled off: no account to promise, connect to or retry.
  await expect(page.getByText(/Accounts are coming with Continue with Twitch/).first()).toBeVisible()
  await expect(page.getByText(/free Pulse account/)).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Connect account', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)
  await link()
  await expect(page.getByRole('heading',{name:'My Moments',exact:true})).toBeVisible()
  await expect(page.getByText('Saved comeback',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Preview: Saved comeback',exact:true}).click()
  const preview=page.getByRole('dialog',{name:'Moment preview'})
  await expect(preview.locator('.pl-moment-stats')).toContainText('2,941')
  await expect(preview.locator('.pl-moment-stats')).toContainText('817')
  await expect(preview.locator('.pl-moment-stats')).toContainText('604')
  await expect(preview.locator('.pl-emote-name strong')).toHaveText(['LOL','LO','forsenCD'])
  // Each account link remounts the page, so count the distinct reads, not the requests.
  expect([...new Set(minuteReads)]).toEqual(['/v1/portal/analytics/streams/123456789/minutes?afterOffset=0'])
  await preview.getByRole('button',{name:'Close Moment preview'}).click()
  await page.getByText('More',{exact:true}).click()
  await page.getByRole('button',{name:'Edit note: Saved comeback'}).click()
  await page.getByLabel('Your note').fill('My note across reload')
  await page.getByRole('button',{name:'Save changes',exact:true}).click()
  await expect(page.getByText('My note across reload',{exact:true})).toBeVisible()
  await page.reload()
  await expect(page.getByText('My note across reload',{exact:true})).toBeVisible()
  await page.getByRole('tab',{name:'Storage & privacy',exact:true}).click()
  const capture=page.getByRole('checkbox',{name:/Remember watched moments/})
  await expect(capture).not.toBeChecked()
  await capture.click()
  await expect(capture).toBeChecked()
  await expect(page.getByText('Local history enabled.',{exact:false})).toBeVisible()
  const twitch=await extension.context.newPage()
  await openTwitchChannel(twitch)
  const result=await extension.serviceWorker.evaluate(async ()=>{
    const tab=(await chrome.tabs.query({url:'https://www.twitch.tv/*'}))[0]
    const [response]=await chrome.scripting.executeScript({target:{tabId:tab.id!},world:'ISOLATED',func:async()=>{
      const access=await chrome.runtime.sendMessage({type:'MY_MOMENTS',action:'load'})
      const status=await chrome.runtime.sendMessage({type:'MOMENT_CAPTURE',action:'status'})
      const recorded=await chrome.runtime.sendMessage({type:'MOMENT_CAPTURE',action:'record',epoch:status.epoch,watchedSeconds:10,reference:{id:'moment',channel:'fixturechan',title:'Saved comeback',streamId:'123456789',vodId:'2806037629',offsetSeconds:100,availability:'unresolved'}})
      await chrome.runtime.sendMessage({type:'MOMENT_CAPTURE',action:'record',epoch:status.epoch,watchedSeconds:10,reference:{id:'second',channel:'fixturechan',title:'Another watched moment',streamId:'123456789',vodId:'2806037629',offsetSeconds:200,availability:'unresolved'}})
      return {access,recorded}
    }})
    return response.result
  })
  expect(result.access).toEqual({error:'unauthorized_sender'})
  expect(result.recorded).toEqual({ok:true})
  await page.bringToFront()
  await page.reload()
  await page.getByRole('tab',{name:'History',exact:true}).click()
  await expect(page.getByText('Saved comeback',{exact:true})).toBeVisible()
  await expect(page.getByText(/^Watched \d/).first()).toBeVisible()
  await page.getByRole('button',{name:'Bookmark: Another watched moment',exact:true}).click()
  await expect(page.getByText('Moment saved. It will remain when history expires.',{exact:true})).toBeVisible()
  await page.getByRole('tab',{name:'Storage & privacy',exact:true}).click()
  await page.getByRole('button',{name:/Clear history/}).click()
  await page.getByRole('button',{name:'Confirm change'}).click()
  await page.getByRole('tab',{name:'Bookmarks',exact:true}).click()
  await expect(page.getByText('My note across reload',{exact:true})).toBeVisible()
  await expect(page.getByText('Another watched moment',{exact:true})).toBeVisible()
  await page.getByRole('tab',{name:'History',exact:true}).click()
  await expect(page.getByRole('heading',{name:'No history yet'})).toBeVisible()
  await page.getByRole('tab',{name:'Bookmarks',exact:true}).click()
  for(const width of [1440,390,320]) {
    await page.setViewportSize({width,height:900})
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.screenshot({path:testInfo.outputPath(`my-moments-${width}.png`),fullPage:true})
  }
  expect(refreshes).toBe(1)
  unavailable = true
  await page.reload()
  await expect(page.getByText('Could not reach StreamPulse', { exact: true })).toBeVisible()
  unavailable = false
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByText('My note across reload', { exact: true })).toBeVisible()
  await page.getByRole('listitem').filter({ hasText: 'Another watched moment' }).getByText('More', { exact: true }).click()
  await page.getByRole('button', { name: 'Remove bookmark: Another watched moment', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm change' }).click()
  await page.reload()
  await expect(page.getByText('Another watched moment', { exact: true })).toHaveCount(0)
  await expect(page.getByText('My note across reload', { exact: true })).toBeVisible()
  const disconnected = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ACCOUNT', action: 'disconnect' }))
  expect(disconnected.account.state).toBe('signed_out')
  await expect(page.getByText('Bookmarks are saved on this device', { exact: true })).toBeVisible()
  await expect(page.getByText('My note across reload', { exact: true })).toHaveCount(0)
  const firstAccountItems = items
  items = []
  accountId = '33333333-3333-4333-8333-333333333333'
  await link()
  await expect(page.getByRole('heading', { name: 'No bookmarks yet' })).toBeVisible()
  await expect(page.getByText('My note across reload', { exact: true })).toHaveCount(0)
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SUPPORTER_ACCOUNT', action: 'disconnect' }))
  accountId = '22222222-2222-4222-8222-222222222222'
  items = firstAccountItems
  await link()
  // The bookmark is the account's and comes back; the note was this browser's
  // copy and was removed when it signed out of the account.
  await expect(page.getByText('Saved comeback', { exact: true })).toBeVisible()
  await expect(page.getByText('My note across reload', { exact: true })).toHaveCount(0)
  const publicStorage = await extension.serviceWorker.evaluate(() => chrome.storage.local.get(null))
  expect(JSON.stringify(publicStorage)).not.toContain(bearer)
  expect(JSON.stringify(publicStorage)).not.toContain('b'.repeat(64))
})

test('previewing a save with no stream id shows no numbers and reads no minutes', async ({ extension, prepare }) => {
  await prepare()
  const minuteReads: string[] = []
  await extension.context.route('https://api.streampulse.stream/v1/portal/analytics/streams/*/minutes**', async route => {
    minuteReads.push(route.request().url())
    await route.fulfill({ status: 200, json: { streamId: '0', channel: 'fixturechan', startedAt: '2026-10-18T21:45:00Z', updatedAt: 1, minutes: [] } })
  })
  // A signed-out save from the Twitch page that knows its replay but not its stream.
  const twitch = await extension.context.newPage()
  await openTwitchChannel(twitch)
  const saved = await extension.serviceWorker.evaluate(async () => {
    const tab = (await chrome.tabs.query({ url: 'https://www.twitch.tv/*' }))[0]
    const [response] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, world: 'ISOLATED', func: () => chrome.runtime.sendMessage({
      type: 'SAVE_BOOKMARK', bookmark: { login: 'fixturechan', vodId: '2806037629', offsetSeconds: 100, label: 'Saved without stream', source: 'extension' } }) })
    return response.result
  })
  expect(saved.item.streamId).toBeUndefined()
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#moments`)
  await page.getByRole('button', { name: 'Preview: Saved without stream', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Moment preview' })
  // The unavailable state, not a chart or a grid of zeros; one screen, no tabs.
  await expect(preview.getByRole('status')).toBeVisible()
  await expect(preview.locator('.pl-moment-stats, .pl-emote-mix, dd, .pl-around-chart, .pl-around-frame, [role="tab"]')).toHaveCount(0)
  expect(await preview.locator('.pl-around-body').innerText()).not.toMatch(/(^|[^\d:.,])0(?![\d:.,])/)
  // No stream id: no session page to open. The VOD still clips, from 30 s before the moment.
  await expect(preview.getByRole('link', { name: /Analysis/ })).toHaveCount(0)
  await preview.getByRole('button', { name: 'Clip', exact: true }).click()
  const onTwitch = preview.getByRole('link', { name: /Clip on Twitch/ })
  await expect(onTwitch).toBeFocused()
  await expect(onTwitch).toHaveAttribute('href', 'https://www.twitch.tv/videos/2806037629?t=0h01m10s')
  await expect(onTwitch).toHaveAttribute('target', '_blank')
  await expect(preview.getByText('Twitch makes the clip, up to 60 s.', { exact: true })).toBeVisible()
  // The window's controls work from the keyboard.
  await preview.getByRole('button', { name: '+15 s', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(onTwitch).toHaveAttribute('href', 'https://www.twitch.tv/videos/2806037629?t=0h01m25s')
  await preview.getByRole('button', { name: '30 s', exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(preview.getByRole('button', { name: '30 s', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await preview.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(preview.getByRole('button', { name: 'Clip', exact: true })).toBeFocused()
  // No stream id, so nothing asks the minutes route.
  expect(minuteReads).toEqual([])
})

test('removing the bookmark in Preview offers Undo, which brings it back with its note', async ({ extension, prepare }) => {
  await prepare()
  const twitch = await extension.context.newPage()
  await openTwitchChannel(twitch)
  await extension.serviceWorker.evaluate(async () => {
    const tab = (await chrome.tabs.query({ url: 'https://www.twitch.tv/*' }))[0]
    await chrome.scripting.executeScript({ target: { tabId: tab.id! }, world: 'ISOLATED', func: () => chrome.runtime.sendMessage({
      type: 'SAVE_BOOKMARK', bookmark: { login: 'fixturechan', vodId: '2806037629', offsetSeconds: 100, label: 'Undo me', source: 'extension' } }) })
  })
  const page = extension.page
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#moments`)
  await page.getByText('More', { exact: true }).click()
  await page.getByRole('button', { name: 'Edit note: Undo me', exact: true }).click()
  await page.getByLabel('Your note').fill('Keep this note')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByText('Keep this note', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Preview: Undo me', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Moment preview' })
  // Gone at once, no confirm step; Preview stays on the moment with Undo.
  await preview.getByRole('button', { name: 'Remove bookmark: Undo me', exact: true }).click()
  await expect(preview.getByText('Bookmark removed.', { exact: true })).toBeVisible()
  await expect(preview.getByRole('button', { name: 'Bookmark: Undo me', exact: true })).toBeVisible()
  await preview.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(preview.getByRole('button', { name: 'Remove bookmark: Undo me', exact: true })).toBeVisible()
  await expect(preview.getByText('Bookmark removed.', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Bookmark restored with its note.', { exact: true })).toBeAttached()
  await preview.getByRole('button', { name: 'Close Moment preview', exact: true }).click()
  await page.reload()
  await expect(page.getByText('Undo me', { exact: true })).toBeVisible()
  await expect(page.getByText('Keep this note', { exact: true })).toBeVisible()
})
