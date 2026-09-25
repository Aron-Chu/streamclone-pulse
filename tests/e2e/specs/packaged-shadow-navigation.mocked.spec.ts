import type { CDPSession, Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXTENSION_DIST_DIR } from '../helpers/extensionContext.ts'
import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

interface DomNode {
  nodeId: number
  nodeName: string
  nodeValue: string
  attributes?: string[]
  children?: DomNode[]
  shadowRoots?: DomNode[]
  shadowRootType?: string
}

function attr(node: DomNode, name: string): string | undefined {
  const index = node.attributes?.indexOf(name) ?? -1
  return index >= 0 ? node.attributes?.[index + 1] : undefined
}

function flatten(node: DomNode): DomNode[] {
  return [node, ...[...(node.children ?? []), ...(node.shadowRoots ?? [])].flatMap(flatten)]
}

function text(node: DomNode): string {
  return node.nodeValue + (node.children ?? []).map(text).join('')
}

// Use DevTools only for observation/coordinates; mouse and keyboard events
// still exercise the real closed-shadow event path in an unmodified store build.
async function findNode(cdp: CDPSession, predicate: (node: DomNode) => boolean): Promise<DomNode> {
  let found: DomNode | undefined
  await expect.poll(async () => {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
    found = flatten(root).find(predicate)
    return Boolean(found)
  }).toBe(true)
  return found!
}

async function clickNode(page: Page, cdp: CDPSession, node: DomNode): Promise<void> {
  await cdp.send('DOM.scrollIntoViewIfNeeded', { nodeId: node.nodeId })
  const { model } = await cdp.send('DOM.getBoxModel', { nodeId: node.nodeId })
  const [x1, y1, x2, y2, x3, y3, x4, y4] = model.border
  await page.mouse.click((x1 + x2 + x3 + x4) / 4, (y1 + y2 + y3 + y4) / 4)
}

test('packaged shadow surface switches every range and opens hub and Supporter', async ({ extension, prepare }, info) => {
  await prepare({ storage: { defaultChartWindow: '60m', defaultChartWindowMigratedToFullV3: true } })
  await extension.context.route('https://streampulse.stream/**', route => route.fulfill({
    contentType: 'text/html', body: '<title>Mock analytics destination</title>',
  }))
  const page = extension.page
  await openTwitchChannel(page)
  const cdp = await extension.context.newCDPSession(page)
  const host = await findNode(cdp, node => attr(node, 'id') === 'streamclone-pulse-root' && Boolean(node.shadowRoots?.length))
  const target = JSON.parse(readFileSync(join(EXTENSION_DIST_DIR, 'extension-target.json'), 'utf8')).target
  expect(host.shadowRoots?.[0].shadowRootType).toBe(target === 'development' ? 'open' : 'closed')

  for (const label of [
    '15 min', '30 min', '1 hour', '2 hours', '4 hours', 'Full stream',
    '1 hour', 'Full stream',
  ]) {
    const trigger = await findNode(cdp, node => attr(node, 'aria-label') === 'Chart time range' && attr(node, 'role') === 'combobox')
    await clickNode(page, cdp, trigger)
    const option = await findNode(cdp, node => attr(node, 'role') === 'option' && text(node).replace('✓', '').trim() === label)
    await clickNode(page, cdp, option)
    await expect.poll(() => extension.serviceWorker.evaluate(async () => (await chrome.storage.sync.get('defaultChartWindow')).defaultChartWindow)).toBe('60m')
    await findNode(cdp, node => attr(node, 'role') === 'combobox' && text(node).includes(label) && attr(node, 'aria-expanded') === 'false')
  }
  await page.screenshot({ path: info.outputPath(`pulse-${target}.png`), animations: 'disabled' })

  const hub = await findNode(cdp, node => (attr(node, 'class') ?? '').split(/\s+/).includes('pulse-analytics-hub-cta'))
  const openedHub = extension.context.waitForEvent('page')
  await clickNode(page, cdp, hub)
  const analytics = await openedHub
  await expect(analytics).toHaveURL('https://streampulse.stream/analytics')
  expect(await analytics.evaluate(() => window.opener === null)).toBe(true)
  await analytics.close()
  await page.bringToFront()

  await clickNode(page, cdp, await findNode(cdp, node => attr(node, 'aria-label') === 'Open settings'))
  const supporter = await findNode(cdp, node => attr(node, 'data-settings-host-cta') === 'supporter')
  await page.screenshot({ path: info.outputPath(`quick-settings-${target}.png`), animations: 'disabled' })
  const openedSettings = extension.context.waitForEvent('page')
  await clickNode(page, cdp, supporter)
  const settings = await openedSettings
  await expect(settings).toHaveURL(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
  await expect(settings.getByRole('heading', { name: 'Account & Supporter', exact: true })).toBeVisible()
  await cdp.detach()
})
