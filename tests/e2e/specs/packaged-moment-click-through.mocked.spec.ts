import type { CDPSession } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXTENSION_DIST_DIR } from '../helpers/extensionContext.ts'
import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

/**
 * Store builds attach a closed shadow root, which hides the pressed control
 * from document listeners. The chart's outside-press check used to read every
 * press in the panel as "outside", so pressing the next Top Moments row closed
 * the card and the click never selected it. DevTools reads the closed tree
 * here only to observe; the mouse drives the real event path.
 */
interface DomNode { nodeId: number; nodeName: string; attributes?: string[]; children?: DomNode[]; shadowRoots?: DomNode[]; shadowRootType?: string }
const attr = (node: DomNode, name: string) => { const i = node.attributes?.indexOf(name) ?? -1; return i >= 0 ? node.attributes?.[i + 1] : undefined }
const flatten = (node: DomNode): DomNode[] => [node, ...[...(node.children ?? []), ...(node.shadowRoots ?? [])].flatMap(flatten)]
const hasClass = (node: DomNode, name: string) => (attr(node, 'class') ?? '').split(/\s+/).includes(name)

async function tree(cdp: CDPSession): Promise<DomNode[]> {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
  return flatten(root)
}

async function centerOf(cdp: CDPSession, node: DomNode, scroll = true): Promise<{ x: number; y: number }> {
  if (scroll) await cdp.send('DOM.scrollIntoViewIfNeeded', { nodeId: node.nodeId })
  const { model } = await cdp.send('DOM.getBoxModel', { nodeId: node.nodeId })
  const [x1, y1, x2, y2, x3, y3, x4, y4] = model.border
  return { x: (x1 + x2 + x3 + x4) / 4, y: (y1 + y2 + y3 + y4) / 4 }
}

test('pressing the next Top Moments row keeps the card and selects that row', async ({ extension, prepare }) => {
  await prepare({ scenario: 'vod-ready', twitchKind: 'vod', storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } })
  await extension.page.setViewportSize({ width: 1440, height: 2200 })
  const page = extension.page
  await openTwitchChannel(page)
  const cdp = await extension.context.newCDPSession(page)
  await expect.poll(async () => (await tree(cdp)).filter(node => hasClass(node, 'pulse-moment-row-button')).length).toBeGreaterThan(1)
  const host = (await tree(cdp)).find(node => attr(node, 'id') === 'streamclone-pulse-root' && node.shadowRoots?.length)!
  const target = JSON.parse(readFileSync(join(EXTENSION_DIST_DIR, 'extension-target.json'), 'utf8')).target
  expect(host.shadowRoots?.[0].shadowRootType).toBe(target === 'development' ? 'open' : 'closed')

  const rows = async () => (await tree(cdp)).filter(node => hasClass(node, 'pulse-moment-row-button'))
  // The Top Moments card's label: "Selected moment at …" once a row is picked.
  const label = async () => {
    const card = (await tree(cdp)).find(node => attr(node, 'data-selected-moment-card') === 'true')
    return card ? attr(card, 'aria-label') ?? null : null
  }

  const first = await centerOf(cdp, (await rows())[0]!)
  await page.mouse.click(first.x, first.y)
  await expect.poll(label).toMatch(/^Selected moment at /)
  const firstLabel = await label()

  // Measure the next row once the rows have settled.
  await page.waitForTimeout(400)
  let second = await centerOf(cdp, (await rows())[1]!)
  await expect.poll(async () => {
    const now = await centerOf(cdp, (await rows())[1]!, false)
    const settled = Math.abs(now.y - second.y) < 0.5
    second = now
    return settled
  }).toBe(true)
  // A real press lasts a moment. Before the fix the card began closing on
  // pointerdown, the rows moved under the held pointer and the click was lost.
  // Observe only before and after: DevTools reads during the press would
  // change its timing.
  await page.mouse.move(second.x, second.y)
  await page.mouse.down()
  await page.waitForTimeout(120)
  await page.mouse.up()
  await expect.poll(async () => attr((await rows())[1]!, 'aria-pressed')).toBe('true')
  await expect.poll(label).not.toBe(firstLabel)
  expect(await label()).toMatch(/^Selected moment at /)
})
