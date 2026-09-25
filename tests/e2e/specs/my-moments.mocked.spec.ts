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
  await expect(page.getByText('Bookmarks need your Pulse account', { exact: true })).toBeVisible()
  await link()
  await expect(page.getByRole('heading',{name:'My Moments',exact:true})).toBeVisible()
  await expect(page.getByText('Saved comeback',{exact:true})).toBeVisible()
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
  await expect(page.getByText('Bookmarks need your Pulse account', { exact: true })).toBeVisible()
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
  await expect(page.getByText('My note across reload', { exact: true })).toBeVisible()
  const publicStorage = await extension.serviceWorker.evaluate(() => chrome.storage.local.get(null))
  expect(JSON.stringify(publicStorage)).not.toContain(bearer)
  expect(JSON.stringify(publicStorage)).not.toContain('b'.repeat(64))
})
