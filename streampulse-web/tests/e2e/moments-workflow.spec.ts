import { test, expect, type Page } from '@playwright/test'
import { installHubUxMock } from './helpers/momentshubUxMock'
import { installNewsroomMock, newsroomFixture } from './helpers/momentsnewsroomMock'
import portalTimingFixture from '../fixtures/portal_vod_timing_v1.json' with { type: 'json' }

async function selectPulseOption(page: Page, triggerName: string, optionName: string) {
  const trigger = page.getByRole('combobox', { name: triggerName })
  await trigger.click()
  await page.getByRole('listbox').getByRole('option', { name: optionName, exact: true }).click()
  await expect(trigger).toContainText(optionName)
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  return trigger
}

async function captureSyntheticWorkflow(page: Page, path: string) {
  await expect(page.locator('.moments-workspace')).toBeVisible()
  for (const artwork of await page.locator('.moments-category-art').all()) {
    await artwork.scrollIntoViewIfNeeded()
    await expect(artwork).not.toHaveAttribute('data-artwork-state', 'loading')
  }
  // Full-page captures otherwise composite the fixed shell at the current scroll offset.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await recordComposition(page, path)
  await page.screenshot({ path, fullPage: true })
}

async function recordComposition(page: Page, name: string) {
  const geometry = await page.evaluate(() => {
    const selectors = ['.moments-result', '.moments-review-heading', '.moment-vod-preview', '.moment-vod-preview iframe',
      '.moments-detail > .moments-identity', '.moments-detail > .moments-source-state', '.moments-measurement',
      '.moments-reactions', '.moments-primary-actions', '.discovery-calendar__heading', '.discovery-year__row',
      '.moments-results-heading', '.moments-broadcast-group', '.moments-filter-note', '.moments-broadcast-scope']
    return Object.fromEntries(selectors.map(selector => [selector, [...document.querySelectorAll(selector)].slice(0, 6).map(node => {
      const r = node.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height }
    })]))
  })
  await test.info().attach(name.split(/[\\/]/).pop()!.replace('.png', '-geometry.json'), {
    body: JSON.stringify(geometry, null, 2), contentType: 'application/json',
  })
  console.log('COMPOSITION', name.split(/[\\/]/).pop(), JSON.stringify(geometry))
}

async function expectStableSave(page: Page, scope: string) {
  const root = page.locator(scope).first()
  const save = root.locator('.moment-save-control button')
  await save.scrollIntoViewIfNeeded()
  const bounds = () => root.evaluate(element => [element, ...element.querySelectorAll('.moments-actions, .moments-actions button, .moments-actions a')].filter(node => !node.closest('details:not([open])')).map(node => {
    const rect = node.getBoundingClientRect()
    return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height }
  }))
  const before = await bounds()
  for (const pressed of ['true', 'false']) {
    await save.click()
    await expect(save).toHaveAttribute('aria-pressed', pressed)
    await expect(save).toBeFocused()
    await expect.poll(bounds).toEqual(before)
    const status = root.locator('.moment-save-control').getByRole('status')
    await expect(status).toHaveText(pressed === 'true' ? 'Saved on this device.' : 'Removed from saved moments.')
    await expect(save).toHaveAttribute('aria-describedby', await status.getAttribute('id') || '')
    expect(await root.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  }
}

// Six synthetic detections, two broadcasts, three supplied reactions per row.
// These fixtures test composition only, never live history or provider playback.
async function installDenseCompositionFixture(page: Page) {
  const at = Date.now()
  const moments = Array.from({ length: 6 }, (_, i) => ({
    publicMomentId: `synthetic-dense-${i}`, login: i < 3 ? 'xqc' : 'sodapoppin',
    displayName: i < 3 ? 'xQc' : 'sodapoppin', streamId: i < 3 ? 's1' : 's2',
    offsetSeconds: 120 + i * 60, at: at - i * 60_000, label: `Synthetic reaction ${i + 1}`,
    kind: 'emote_spike', source: 'live_irc', chatPerMin: 100 + i, emotesPerMin: 50 + i,
    category: ['Minecraft', 'No supplied artwork', 'Rejected category', 'Failed category', 'Minecraft', 'No supplied artwork'][i],
    ...(i === 2 ? { categoryId: '123', boxArtUrl: 'https://untrusted.invalid/rejected.jpg' } : {}),
    ...(i === 3 ? { categoryId: '456', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/456-144x192.jpg' } : {}),
    ...(i === 0 || i === 3 ? { archiveArtwork: { kind: 'archive_thumbnail', vodId: '123456',
      url: `https://static-cdn.jtvnw.net/cf_vods/synthetic/thumb/${i === 0 ? 'ready' : 'failed'}.jpg` } } : {}),
    topEmotes: ['One', 'Two', 'Three'].map((name, j) => ({ name, provider: '7tv', count: 10 + j,
      imageUrl: `https://cdn.7tv.app/emote/synthetic-${name}/1x.webp` })),
  }))
  await page.route(/\/v1\/public\/hub\/moments\/recent(?:\?.*)?$/, route => route.fulfill({ json: {
    hubGeneratedAt: new Date(at).toISOString(), source: 'public_hub_live_pulse_moments', status: 'ready', limit: 10, hasMore: true, moments,
  } }))
  await page.route('https://static-cdn.jtvnw.net/**', route => route.request().url().includes('failed') || route.request().url().includes('/456-')
    ? route.fulfill({ status: 404, body: '' })
    : route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="192"><rect width="144" height="192" fill="#379a86"/><text x="8" y="90">Fixture artwork</text></svg>' }))
  await page.route('https://cdn.7tv.app/emote/synthetic-*/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32"><rect width="48" height="32" fill="#9fd9ba"/></svg>' }))
  await page.route('https://player.twitch.tv/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Synthetic player contract, not footage</p>' }))
}

async function topViewport(page: Page) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0)
}

async function expectInFirstViewport(page: Page, selector: string) {
  const boxes = await page.locator(selector).evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }
  }))
  expect.soft(boxes.length, selector).toBeGreaterThan(0)
  for (const box of boxes) {
    expect.soft(box.top, `${selector} top`).toBeGreaterThanOrEqual(0)
    expect.soft(box.bottom, `${selector} bottom`).toBeLessThanOrEqual(960)
    expect.soft(box.height, `${selector} height`).toBeGreaterThan(0)
    expect.soft(box.width, `${selector} width`).toBeGreaterThan(0)
    expect.soft(box.left, `${selector} left`).toBeGreaterThanOrEqual(0)
    expect.soft(box.right, `${selector} right`).toBeLessThanOrEqual(page.viewportSize()!.width)
  }
}

for (const width of [390, 1440]) {
  for (const outcome of ['ready', 'failed'] as const) {
    test(`dense artwork geometry ${outcome} at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 960 })
      await installDenseCompositionFixture(page)
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      await page.route('https://static-cdn.jtvnw.net/cf_vods/synthetic/thumb/ready.jpg', async route => {
        await gate
        await route.fulfill(outcome === 'failed' ? { status: 404, body: '' } : { contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#379a86"/></svg>' })
      })
      await page.goto('/analytics/moments', { waitUntil: 'domcontentloaded' })
      const first = page.locator('.moments-result').first()
      await expect(first).toBeVisible()
      await first.scrollIntoViewIfNeeded()
      await expect(first.locator('.moments-gallery-media')).toHaveCount(0)
      const bounds = () => first.evaluate(node => [node, node.querySelector('[data-column="Moment"]')!, node.querySelector('[data-column="Save"]')!].map(element => {
        const r = element.getBoundingClientRect()
        return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }
      }))
      const before = await bounds()
      release()
      // Loading optional imagery must not expand the collapsed evidence row.
      await expect.poll(bounds).toEqual(before)
      await first.locator('.moments-recent-artwork summary').click()
      if (outcome === 'ready') {
        const image = first.locator('.moments-card-artwork img')
        await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(640)
        await image.evaluate((img: HTMLImageElement) => img.decode())
      } else await expect(first.locator('.moments-card-artwork img')).toHaveCount(0)
      await first.screenshot({ path: info.outputPath(`dense-artwork-transition-${outcome}-${width}.png`) })
      await first.locator('.moments-recent-artwork summary').click()
      await expect.poll(bounds).toEqual(before)
      await captureSyntheticWorkflow(page, info.outputPath(`dense-artwork-${outcome}-${width}.png`))
    })
  }
  test(`cover rail and scroll-accessible Recent rows and Saved gallery at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 })
    await installDenseCompositionFixture(page)
    await page.goto('/analytics/moments')
    await expect(page.locator('.moments-result')).toHaveCount(6)
    for (const collection of ['recent', 'saved']) {
      if (collection === 'saved') {
        for (const button of await page.locator('.moments-result .moment-save-control button').all()) await button.click()
        await page.getByRole('button', { name: 'Saved (6)', exact: true }).click()
        await expect(page.locator('.moments-result--gallery')).toHaveCount(6)
      }
      await captureSyntheticWorkflow(page, info.outputPath(`dense-${collection}-${width}.png`))
      await page.screenshot({ path: info.outputPath(`dense-${collection}-viewport-${width}.png`) })
      const cards = page.locator('.moments-result')
      if (collection === 'recent') {
        await expect(page.locator('.moments-result--compact')).toHaveCount(6)
        await expect(page.locator('.moments-gallery-media, .moments-reaction-visual')).toHaveCount(0)
      }
      if (width === 1440 && collection === 'saved') {
        const rail = (await page.locator('.moments-category-browser').boundingBox())!
        expect.soft((await cards.first().boundingBox())!.y, 'cards follow readable category covers').toBeGreaterThanOrEqual(rail.y + rail.height)
        const first = (await cards.first().boundingBox())!
        const third = (await cards.nth(2).boundingBox())!
        const fourth = (await cards.nth(3).boundingBox())!
        expect.soft(third.y, 'three cards in the first row').toBe(first.y)
        expect.soft(fourth.y, 'second row starts below first').toBeGreaterThanOrEqual(first.y + first.height)
      }
      // The approved larger rail replaces above-fold density, not access to
      // category labels or later rows. Verify actual scroll/focus destinations.
      await page.keyboard.press('Tab')
      for (const category of await page.locator('[data-category-action="category"]').all()) {
        await category.scrollIntoViewIfNeeded()
        await category.focus()
        await expect(category).toBeFocused()
        await expect(category).toBeInViewport({ ratio: 1 })
        expect(await category.locator('.moments-category-art').boundingBox()).toMatchObject(width < 768 ? { width: 96, height: 128 } : { width: 120, height: 160 })
        expect(await category.evaluate(node => {
          const label = node.querySelector('strong')!.getBoundingClientRect()
          const art = node.querySelector('.moments-category-art')!.getBoundingClientRect()
          const box = node.getBoundingClientRect()
          return label.top >= art.bottom && label.bottom <= box.bottom && label.left >= box.left && label.right <= box.right
        }), 'full category label below cover and inside control').toBe(true)
      }
      for (const index of [0, 2, 3, 5]) {
        const action = cards.nth(index).locator(collection === 'recent' ? '[data-discovery-key]' : '.moments-review-action')
        await action.scrollIntoViewIfNeeded()
        await action.focus()
        await action.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }))
        await expect(action).toBeFocused()
        await expect(action).toBeInViewport({ ratio: 1 })
        expect(await action.evaluate(node => {
          const r = node.getBoundingClientRect()
          return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
        }), 'focused Review action is not covered').toBe(true)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    }
  })

  for (const sourceState of ['mapped', 'unavailable', 'failed'] as const) {
    test(`dense composition shared review ${sourceState} at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 960 })
      await installDenseCompositionFixture(page)
      if (sourceState !== 'mapped') await page.route(/\/v1\/portal\/analytics\/streams\/s1(?:\?.*)?$/, route => route.fulfill(sourceState === 'failed'
        ? { status: 503, json: {} } : { json: { channel: 'xqc', stream: { streamId: 's1' }, availability: { vodState: 'unavailable' } } }))
      await page.goto('/analytics/moments')
      await expect(page.locator('.moments-result')).toHaveCount(6)
      await page.locator('[data-discovery-key]').first().click()
      if (sourceState === 'mapped') await expect(page.getByRole('link', { name: /^Watch at/ })).toBeVisible()
      else await expect(page.locator('.moments-source-state')).toHaveAttribute('data-source-state', sourceState)
      await expect(page.locator('.moments-reactions li')).toHaveCount(3)
       await page.locator('.moments-detail').scrollIntoViewIfNeeded()
      await recordComposition(page, `dense-review-${sourceState}-${width}.png`)
      await page.screenshot({ path: info.outputPath(`dense-review-${sourceState}-${width}.png`), fullPage: true })
      await page.screenshot({ path: info.outputPath(`dense-review-${sourceState}-viewport-${width}.png`) })
      const sourceSelector = sourceState === 'mapped' ? '.moment-vod-preview' : '.moments-detail > .moments-source-state'
      await expectInFirstViewport(page, `.moments-review-heading, .moments-detail > .moments-identity, ${sourceSelector}`)
      if (width === 1440) {
         await expect(page.locator('.moments-measurement')).toBeVisible()
         await expect(page.locator('.moments-reactions')).toBeVisible()
         await page.locator('.moments-primary-actions').scrollIntoViewIfNeeded()
         await expect(page.locator('.moments-primary-actions')).toBeInViewport()
        if (sourceState === 'mapped') {
          const frame = page.locator('.moment-vod-preview iframe')
          const size = (await frame.boundingBox())!
          expect.soft(size.width, 'Twitch embed minimum width').toBeGreaterThanOrEqual(400)
          expect.soft(size.height, 'Twitch embed minimum height').toBeGreaterThanOrEqual(300)
          await expect(frame).toHaveAttribute('src', /autoplay=false/)
        }
        const queue = (await page.locator('.moments-results').boundingBox())!
        const detail = (await page.locator('.moments-detail').boundingBox())!
        expect.soft(queue.x + queue.width).toBeLessThanOrEqual(detail.x)
      } else {
        const source = (await page.locator(sourceSelector).boundingBox())!
        const queue = await page.locator('.moments-results').boundingBox()
        // A collapsed mobile queue is allowed; a visible queue must follow the selected source.
        if (queue?.height) expect.soft(source.y + source.height).toBeLessThanOrEqual(queue.y)
      }
      if (sourceState !== 'mapped') {
        await expect(page.locator('.moments-detail iframe')).toHaveCount(0)
        await expect(page.getByRole('link', { name: /^Watch at/ })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Recheck source' })).toHaveCount(1)
      }
    })
  }
}

for (const width of [320, 390, 1440]) {
  test(`decoded non-square Saved evidence and session back geometry at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 })
    await page.addInitScript(() => localStorage.setItem('streampulse.saved-moments.v2', JSON.stringify({ version: 2, items: [{
      login: 'xqc', streamId: 's1', offsetSeconds: 120, publicMomentId: 'synthetic-wide',
      label: 'Synthetic wide reaction', savedAt: Date.now(), topEmotes: [{ name: 'Wide', count: 7 }],
    }] })))
    let recapReads = 0
    await page.route('**/v1/portal/analytics/streams/s1/recap', route => {
      recapReads++
      return route.fulfill({ json: { login: 'xqc', streamId: 's1', topMoments: [{
        offsetSeconds: 120, publicMomentId: 'synthetic-wide', chatPerMin: 20, emotesPerMin: 10,
        topEmotes: [{ code: 'Wide', count: 99, imageUrl: 'https://cdn.7tv.app/emote/synthetic-wide/1x.webp' }],
      }] } })
    })
    await page.route('https://cdn.7tv.app/emote/synthetic-wide/**', route => route.fulfill({
      contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="24"><rect width="96" height="24" fill="#30b898"/><circle cx="48" cy="12" r="10" fill="#fff"/></svg>',
    }))
    await page.route(/\/v1\/portal\/analytics\/streams\/s1(?:\?.*)?$/, route => route.fulfill({ json: { channel: 'xqc', stream: { streamId: 's1' } } }))
    await page.goto('/analytics/moments?view=saved')
    const decoded = async (selector: string) => {
      const image = page.locator(selector).first()
      await expect(image).toBeVisible()
      await expect.poll(() => image.evaluate((node: HTMLImageElement) => [node.naturalWidth, node.naturalHeight])).toEqual([96, 24])
      await image.evaluate((node: HTMLImageElement) => node.decode())
      expect.soft(await image.evaluate(node => getComputedStyle(node).objectFit), selector).toBe('contain')
    }
    await decoded('.moments-gallery-media img')
    await captureSyntheticWorkflow(page, info.outputPath(`decoded-saved-${width}.png`))
    const galleryReads = recapReads
    await page.locator('[data-discovery-key]').click()
    await decoded('.moments-reactions img')
    await expect(page.locator('.moments-reactions')).toContainText('7 uses')
    expect(recapReads).toBe(galleryReads)
    if (width === 1440) await decoded('.moments-row-emotes img')
    await captureSyntheticWorkflow(page, info.outputPath(`decoded-review-${width}.png`))
    await page.getByRole('button', { name: 'Back to results' }).click()
    await expect(page.locator('.moments-detail')).toHaveCount(0)
    await page.getByRole('button', { name: 'Sessions', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Sessions', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('searchbox').fill('xqc')
    const session = page.locator('[data-story-id="story-xqc"]')
    await session.click()
    const back = page.getByRole('button', { name: 'All sessions', exact: true })
    await expect(back).toHaveClass('moments-session-back')
    const bounds = await back.boundingBox()
    expect.soft(bounds!.width, 'content-sized session back').toBeLessThan(220)
    expect.soft(bounds!.height, 'compact session back').toBeLessThan(65)
    await captureSyntheticWorkflow(page, info.outputPath(`session-back-${width}.png`))
    await back.click()
    await expect(session).toBeFocused()
    await expect(page.getByRole('searchbox')).toHaveValue('xqc')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  })
}

for (const legacy of [true, false]) {
  test(`Saved gallery/detail enrichment ${legacy ? 'negative control reproduces old mismatch' : 'reuses compatible evidence without a second read'}`, async ({ page }) => {
    let legacyWiringInstalled = false
    if (legacy) {
      // Reproduce the old selection wiring in this isolated browser only, leaving disk work intact.
      await page.route('**/src/routes/analytics/AnalyticsMomentsPage.tsx*', async route => {
        const response = await route.fetch()
        const body = await response.text()
        expect(body).toContain('savedEvidence ?? selected ?? selectionSeed')
        legacyWiringInstalled = true
        await route.fulfill({ response, body: body.replace('savedEvidence ?? selected ?? selectionSeed', 'selected ?? selectionSeed') })
      })
    }
    await page.addInitScript(() => localStorage.setItem('streampulse.saved-moments.v2', JSON.stringify({ version: 2, items: [{
      login: 'xqc', streamId: 's1', offsetSeconds: 120, publicMomentId: 'synthetic-wide',
      label: 'Synthetic saved reaction', savedAt: Date.now(), topEmotes: [{ name: 'Wide', count: 7 }],
    }] })))
    let reads = 0
    let reviewOpened = false
    await page.route('**/v1/portal/analytics/streams/s1/recap', route => {
      reads++
      return reviewOpened ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({ json: { login: 'xqc', streamId: 's1', topMoments: [{
        offsetSeconds: 120, publicMomentId: 'synthetic-wide', chatPerMin: 20, emotesPerMin: 10,
        topEmotes: [{ code: 'Wide', count: 99, imageUrl: 'https://cdn.7tv.app/emote/synthetic-wide/1x.webp' }],
      }] } })
    })
    await page.route('https://cdn.7tv.app/emote/synthetic-wide/**', route => route.fulfill({
      contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="24"><rect width="96" height="24" fill="green"/></svg>',
    }))
    await page.route(/\/v1\/portal\/analytics\/streams\/s1(?:\?.*)?$/, route => route.fulfill({ json: { channel: 'xqc', stream: { streamId: 's1' } } }))
    await page.goto('/analytics/moments?view=saved')
    const gallery = page.locator('.moments-gallery-media img')
    await gallery.scrollIntoViewIfNeeded()
    await expect.poll(() => gallery.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(96)
    expect(legacyWiringInstalled).toBe(legacy)
    const galleryReads = reads
    reviewOpened = true
    await page.locator('[data-discovery-key]').click()
    if (legacy) {
      await expect(page.getByText('Reaction details could not be loaded.', { exact: false })).toBeVisible()
      await expect(page.locator('.moments-reactions img')).toHaveCount(0)
      expect(reads).toBeGreaterThan(galleryReads)
    } else {
      await page.locator('.moments-reactions img').scrollIntoViewIfNeeded()
      await expect.poll(() => page.locator('.moments-reactions img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(96)
      expect(reads).toBe(galleryReads)
    }
    await expect(page.locator('.moments-reactions')).toContainText('7 uses')
    await expect(page).toHaveURL(/login=xqc&stream=s1&offset=120&moment=synthetic-wide/)
  })
}

test('shared EmoteImg recovers a decoded replacement after a deterministic image failure', async ({ page }) => {
  await page.route('https://cdn.7tv.app/emote/synthetic-failed/**', route => route.fulfill({ status: 404, body: '' }))
  await page.route('https://cdn.7tv.app/emote/synthetic-recovered/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="24"><rect width="96" height="24" fill="green"/></svg>' }))
  await page.goto('/analytics/moments')
  await page.evaluate(async () => {
    // Reuse Vite's exact React module identity and installed refresh preamble.
    const componentUrl = '/src/ui/components/analytics/EmoteImg.tsx'
    const source = await (await fetch(componentUrl)).text()
    const reactUrl = source.match(/from "([^"]*\/react\.js[^\"]*)"/)![1]
    const React = (await import(reactUrl)).default
    const entry = await (await fetch('/src/main.tsx')).text()
    const domUrl = entry.match(/from "([^"]*\/react-dom_client\.js[^\"]*)"/)![1]
    const { createRoot } = (await import(domUrl)).default
    const { EmoteImg } = await import(componentUrl)
    const host = document.createElement('div'); host.id = 'test'; document.body.prepend(host)
    const root = createRoot(host)
    const replaceEmote = (src: string) => root.render(React.createElement(EmoteImg, { src, name: 'Recovery' }))
    Object.assign(window, { replaceEmote })
    replaceEmote('https://cdn.7tv.app/emote/synthetic-failed/1x.webp')
  })
  await expect(page.locator('#test').getByText('R', { exact: true })).toBeVisible()
  await page.evaluate(() => (window as unknown as { replaceEmote: (src: string) => void }).replaceEmote('https://cdn.7tv.app/emote/synthetic-recovered/1x.webp'))
  await expect.poll(() => page.locator('#test img').evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([96, 24])
  await page.locator('#test img').evaluate((img: HTMLImageElement) => img.decode())
})

for (const width of [390, 1440]) for (const transition of ['unavailable-to-ready', 'loading-to-failed'] as const) {
  test(`category artwork stable footprint ${transition} at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 })
    let releaseImage!: () => void
    const imageGate = new Promise<void>(resolve => { releaseImage = resolve })
    await page.route('https://static-cdn.jtvnw.net/ttv-boxart/123-144x192.jpg', async route => {
      await imageGate
      if (transition === 'loading-to-failed') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="192"><rect width="144" height="192" fill="#30b898"/></svg>' })
    })
    await page.goto('/analytics/moments')
    await page.evaluate(async () => {
      const componentUrl = '/src/ui/components/moments/MomentCategoryBrowser.tsx'
      const source = await (await fetch(componentUrl)).text()
      const reactUrl = source.match(/from "([^"]*\/react\.js[^\"]*)"/)![1]
      const React = (await import(reactUrl)).default
      const entry = await (await fetch('/src/main.tsx')).text()
      const domUrl = entry.match(/from "([^"]*\/react-dom_client\.js[^\"]*)"/)![1]
      const { createRoot } = (await import(domUrl)).default
      const { MomentCategoryBrowser } = await import(componentUrl)
      const host = document.createElement('div')
      host.id = 'category-geometry-test'; host.className = 'moments-workspace'
      document.body.prepend(host)
      const root = createRoot(host)
      // Keep one React root and category identity while metadata arrives.
      const renderCategoryMetadata = (available: boolean) => root.render(React.createElement(MomentCategoryBrowser, {
        items: [{ category: 'A synthetic category', ...(available ? { categoryId: '123', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/123-144x192.jpg' } : {}) }, { category: 'Z neighbor' }],
        selected: '', onSelect: () => {},
      }))
      Object.assign(window, { renderCategoryMetadata })
      renderCategoryMetadata(false)
    })
    const host = page.locator('#category-geometry-test')
    const artwork = host.locator('.moments-category-art').first()
    await expect(artwork).toHaveAttribute('data-artwork-state', 'unavailable')
    await artwork.scrollIntoViewIfNeeded()
    const bounds = () => host.evaluate(element => [element, ...element.querySelectorAll('.moments-category-track, .moments-category-track > button, .moments-category-art')].map(node => {
      const r = node.getBoundingClientRect()
      return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }
    }))
    const unavailable = await bounds()
    await page.evaluate(() => (window as unknown as { renderCategoryMetadata: (available: boolean) => void }).renderCategoryMetadata(true))
    await expect(artwork).toHaveAttribute('data-artwork-state', 'loading')
    const loading = await bounds()
    releaseImage()
    await expect(artwork).toHaveAttribute('data-artwork-state', transition === 'unavailable-to-ready' ? 'ready' : 'failed')
    if (transition === 'unavailable-to-ready') {
      await artwork.locator('img').evaluate((img: HTMLImageElement) => img.decode())
      expect(await artwork.locator('img').evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([144, 192])
    }
    expect(await bounds()).toEqual(transition === 'unavailable-to-ready' ? unavailable : loading)
    // Larger covers supersede compact artwork; every state keeps this footprint.
    expect(await artwork.boundingBox()).toMatchObject(width < 768 ? { width: 96, height: 128 } : { width: 120, height: 160 })
    await host.screenshot({ path: info.outputPath(`category-${transition}-${width}.png`) })
  })
}

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
  await expect(detail.getByRole('link', { name: /^Watch at/ })).toHaveCount(0)
  await expect(detail.locator('iframe')).toHaveCount(0)
  linked = true
  await detail.getByRole('button', { name: 'Recheck source', exact: true }).click()
  await expect(detail.getByRole('link', { name: /^Watch at/ })).toHaveAttribute('href', 'https://www.twitch.tv/videos/2864434763?t=5107s')
  await expect(page).toHaveURL(/stream=321192454233&offset=5183/)
  await expect(detail.locator('iframe')).toHaveAttribute('src', /video=v2864434763&time=5107s&parent=127.0.0.1&autoplay=false/)
  await page.reload()
  await expect(detail.getByRole('link', { name: /^Watch at/ })).toHaveAttribute('href', 'https://www.twitch.tv/videos/2864434763?t=5107s')
})

test('archive-origin contract maps the selected replay and preserves Save outside the playable range', async ({ page }) => {
  await page.route(/\/v1\/portal\/analytics\/streams\/321192454233(?:\?.*)?$/, route => route.fulfill({ json: portalTimingFixture }))
  await page.route('**/v1/portal/analytics/streams/321192454233/recap', route => route.fulfill({ json: {
    login: 'xqc', streamId: '321192454233', topMoments: [{ offsetSeconds: 5183, reasons: ['chat_spike'], topEmotes: [{ code: 'KEKW', count: 45, provider: 'seventv' }] }],
  } }))
  await page.goto('/analytics/moments?login=xqc&stream=321192454233&offset=5183')
  const detail = page.getByRole('region', { name: 'Selected moment', exact: true })
  await expect(detail.getByRole('link', { name: /^Watch at/ })).toHaveAttribute('href', 'https://www.twitch.tv/videos/2864434763?t=5107s')
  await page.goto('/analytics/moments?login=xqc&stream=321192454233&offset=18100')
  await expect(detail.getByText('This detection is outside the archive', { exact: false })).toBeVisible()
  await expect(detail.getByRole('link', { name: /^Watch at/ })).toHaveCount(0)
  await expect(detail.locator('iframe')).toHaveCount(0)
  await detail.getByRole('button', { name: 'Save on this device', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Saved (1)', exact: true })).toBeVisible()
  // A growing archive can become available on an explicit recheck, without
  // changing the selected identity or navigating to a different broadcast.
  await page.route(/\/v1\/portal\/analytics\/streams\/321192454233(?:\?.*)?$/, route => route.fulfill({ json: { ...portalTimingFixture, vodDurationSeconds: 19000 } }))
  await detail.getByRole('button', { name: 'Recheck source', exact: true }).click()
  await expect(detail.getByRole('link', { name: /^Watch at/ })).toHaveAttribute('href', 'https://www.twitch.tv/videos/2864434763?t=18024s')
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
  await expect(detail.getByText('Exact per-emote counts are shown below.', { exact: false })).toBeVisible()
  await expect(detail.getByText('Wrong lead', { exact: true })).toHaveCount(0)
  await expect(detail.getByText('Occurrence time unavailable', { exact: false })).toHaveCount(0)
  await expect(detail.getByRole('link', { name: /^Watch at/ })).toHaveCount(0)
  await page.reload()
  await expect(detail.getByText('GTAB', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.moments-toolbar')).toBeHidden()
  await detail.getByRole('button', { name: 'Back to results' }).click()
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
  // Fixture workflows must never fall through to hosted APIs or media providers.
  await page.route('**/*', route => {
    const host = new URL(route.request().url()).hostname
    return host === '127.0.0.1' || host === 'localhost' ? route.continue() : route.abort()
  })
  await installHubUxMock(page)
  await installNewsroomMock(page)
  await page.route('https://cdn.7tv.app/emote/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32"><rect width="48" height="32" fill="#9fd9ba"/></svg>' }))
  await page.route('**/v1/public/categories/artwork', route => {
    const ids: Record<string, string> = { Minecraft: '27471', 'Just Chatting': '509658' }
    const items = (route.request().postDataJSON() as { items: { categoryId?: string; name?: string }[] }).items
    return route.fulfill({ json: { items: items.map((item, index) => {
      const categoryId = item.categoryId || ids[item.name || '']
      return categoryId ? { index, status: 'resolved', categoryId, name: item.name || 'Synthetic category', matchedBy: item.categoryId ? 'id' : 'name', boxArtUrl: `https://static-cdn.jtvnw.net/ttv-boxart/${categoryId}-210x280.jpg` } : { index, status: 'not_found' }
    }) } })
  })
  await page.route('https://static-cdn.jtvnw.net/ttv-boxart/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="210" height="280"><rect width="210" height="280" fill="#30b898"/><text x="10" y="140">Synthetic cover</text></svg>' }))
  await page.route('**/v1/portal/analytics/streams/*/recap', async route => {
    const parts = new URL(route.request().url()).pathname.split('/')
    const streamId = parts.at(-2) || ''
    await route.fulfill({ json: { login: streamId === 's1' ? 'xqc' : 'sodapoppin', streamId, topMoments: [{
      offsetSeconds: 120,
      reasons: ['twitch_emote_spike'],
      chatPerMin: 393,
      emotesPerMin: 133,
      topEmotes: [
        { code: 'DinoDance', count: 71, provider: 'seventv', imageUrl: 'https://cdn.7tv.app/emote/01GAM8EFQ00004MXFXAJYKA859/2x.webp' },
        { code: 'KEKW', count: 10, provider: 'seventv', imageUrl: 'https://cdn.7tv.app/emote/01GAM8EFQ00004MXFXAJYKA860/2x.webp' },
      ],
    }] } })
  })
  await page.route('**/v1/portal/analytics/streams/*', async route => {
    const streamId = new URL(route.request().url()).pathname.split('/').pop()
    await route.fulfill({ json: { vodTiming: { state: 'verified' }, vodDurationSeconds: 18000, vodAlignSeconds: 0,
      handoffRef: 'cr_Y2NfYWJj', channel: streamId === 's1' ? 'xqc' : 'sodapoppin', stream: { streamId, vodId: '123456' } } })
  })
})

test('reaction sorts persist through review and refresh without implying global ranking', async ({ page }) => {
  await page.goto('/analytics/moments')
  for (const [label, value] of [['Highest emotes/min', 'emotesPerMin'], ['Highest chat/min', 'chatPerMin'], ['Largest emote increase/min', 'emoteIncrease'], ['Largest chat increase/min', 'chatIncrease']]) {
    await selectPulseOption(page, 'Result sort order', label)
    await expect(page).toHaveURL(new RegExp(`sort=${value}`))
    await expect(page.locator('.moments-feed-scope')).toContainText('only to this loaded snapshot')
  }
  await selectPulseOption(page, 'Result sort order', 'Highest emotes/min')
  await expect(page.locator('.moments-result').first()).toContainText('xQc')
  await page.locator('.moments-result').first().getByRole('button', { name: 'Open moment' }).click()
  await page.getByRole('button', { name: 'Back to results', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Result sort order' })).toContainText('Highest emotes/min')
  await page.getByRole('button', { name: 'Sessions', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Result sort order' })).toContainText('Newest first')
})

test('larger category covers are the single browse filter', async ({ page }) => {
  await page.goto('/analytics/moments')
  await expect(page.getByRole('combobox', { name: 'Filter category' })).toHaveCount(0)
  const category = page.locator('.moments-category-track').getByRole('button', { name: /Minecraft/ })
  await expect(category).toBeVisible()
  await expect(category).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  expect(await category.locator('.moments-category-art').boundingBox()).toMatchObject({ width: 120, height: 160 })
  await category.click()
  await expect(page).toHaveURL(/category=Minecraft/)
  await expect(page.locator('.moments-result')).toHaveCount(1)
  await expect(category).toHaveAttribute('aria-pressed', 'true')
})

for (const [width, height] of [[1440, 960], [1280, 800], [768, 1024], [390, 844]]) {
  test(`resolved-cover review contract at ${width}x${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height })
    await installDenseCompositionFixture(page)
    await page.goto('/analytics/moments')
    await expect(page.locator('.moments-result--compact')).toHaveCount(6)
    const rail = page.locator('.moments-category-browser')
    const cover = rail.locator('.moments-category-art').first()
    expect.soft(await cover.boundingBox()).toMatchObject(width < 768 ? { width: 96, height: 128 } : { width: 120, height: 160 })
    await page.locator('[data-discovery-key]').first().focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.moments-review-heading h2')).toBeFocused()
    await expect(rail).toBeVisible()
    const table = page.getByRole('table', { name: 'Loaded detection review', includeHidden: true })
    await expect(table.locator('th')).toHaveText(['Creator', 'Category', 'Event time', 'Moment', 'Emotes', 'Source', 'Save'])
    await expect(table.locator('th[scope="col"]')).toHaveCount(7)
    await expect(table.locator('a button, button a, button button')).toHaveCount(0)
    const firstReview = table.locator('[data-discovery-key]').first()
    await firstReview.focus()
    await page.keyboard.press('Tab')
    await expect(table.locator('tbody tr').first().getByRole('link', { name: 'Stream analytics' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(table.locator('tbody tr').first().locator('.moment-save-control button')).toBeFocused()
    await expect(table.locator('tbody tr').first().locator('.moment-save-control button')).toBeInViewport({ ratio: 1 })
    if (width >= 1280) {
      const columns = await table.evaluate(node => [...node.querySelectorAll('thead th')].map((header, index) => ({
        header: header.getBoundingClientRect().x,
        cells: [...node.querySelectorAll('tbody tr')].map(row => row.children[index].getBoundingClientRect().x),
      })))
      expect.soft(Math.max(...columns.flatMap(column => column.cells.map(cell => Math.abs(cell - column.header)))), 'shared column alignment').toBeLessThanOrEqual(1)
    }
    expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no document overflow').toBe(true)
    const frame = page.locator('.moment-vod-preview iframe')
    if (width >= 768) {
      await expect(frame).toBeVisible()
      const size = (await frame.boundingBox())!
      expect(size.width).toBeGreaterThanOrEqual(400)
      expect(size.height).toBeGreaterThanOrEqual(300)
      await expect(frame).toHaveAttribute('src', /autoplay=false/)
    } else await expect(frame).toHaveCount(0)
    const geometry = await page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight },
      covers: [...document.querySelectorAll('.moments-category-browser .moments-category-art')].map(node => ({ state: node.getAttribute('data-artwork-state'), width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })),
      player: [...document.querySelectorAll('.moment-vod-preview iframe')].map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })),
      documentWidth: document.documentElement.scrollWidth,
    }))
    console.log('RESOLVED_GEOMETRY', JSON.stringify(geometry))
    await test.info().attach(`resolved-${width}-geometry.json`, { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' })
    await topViewport(page)
    await page.screenshot({ path: info.outputPath(`resolved-review-${width}.png`), fullPage: true })
    await page.locator('.moments-review-heading').scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(`resolved-review-viewport-${width}.png`) })
    await page.getByRole('button', { name: 'Back to results', exact: true }).click()
    await expect(page.locator('[data-discovery-key]').first()).toBeFocused()
    await expect(page.locator('.moments-result--compact')).toHaveCount(6)
  })
}

test('creator heatmap is discoverable from a gated snapshot without annual reads', async ({ page }, info) => {
  let historyReads = 0
  await page.route('**/v1/public/discovery**', route => { historyReads++; return route.fulfill({ status: 503, json: {} }) })
  await page.goto('/analytics/moments')
  await expect(page.getByRole('button', { name: 'Creator heatmap', exact: true })).toBeVisible()
  const creator = page.locator('.moments-creator-link').first()
  await expect(creator).toHaveAttribute('href', /calendar=year/)
  await creator.click()
  await expect(page.getByRole('heading', { name: /heatmap unavailable/ })).toBeVisible()
  await expect(page.locator('.discovery-year')).toHaveCount(0)
  expect(historyReads).toBe(0)
  await page.goto('/analytics/moments?view=recent&collection=history&creator=ohnepixel&calendar=year&year=2025&month=2025-09')
  await expect(page.getByRole('heading', { name: '@ohnepixel · 2025 heatmap unavailable' })).toBeVisible()
  for (const [width, height] of [[1440, 960], [390, 844]]) {
    await page.setViewportSize({ width, height })
    await topViewport(page)
    await page.screenshot({ path: info.outputPath(`actual-gated-creator-${width}.png`), fullPage: true })
  }
  expect(historyReads).toBe(0)
})

test('category changes animate the result collection only and respect reduced motion', async ({ page }) => {
  await page.goto('/analytics/moments')
  const results = page.locator('.moments-results')
  await expect(results.locator('.moments-result')).toHaveCount(2)
  await page.evaluate(() => {
    const root = document.querySelector('.moments-results')
    if (!root) throw new Error('Moment results root is missing')
    let animationStarts = 0
    root.addEventListener('animationstart', event => {
      if ((event as AnimationEvent).animationName === 'moments-result-collection-enter') animationStarts += 1
    })
    Object.defineProperty(window, '__momentCollectionAnimationStarts', {
      configurable: true,
      get: () => animationStarts,
      set: value => { animationStarts = Number(value) },
    })
  })
  expect(await results.locator('.moments-recent-feed').getAttribute('data-category-transition')).toBeNull()

  await page.locator('.moments-category-track').getByRole('button', { name: /Minecraft/ }).click()
  await expect(page).toHaveURL(/category=Minecraft/)
  await expect(results.locator('.moments-recent-feed')).toHaveAttribute('data-category-transition', 'true')
  await expect.poll(() => page.evaluate(() => (window as unknown as { __momentCollectionAnimationStarts?: number }).__momentCollectionAnimationStarts ?? 0)).toBe(1)

  const save = results.locator('.moments-result').getByRole('button', { name: 'Save' })
  await save.click()
  await expect(save).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => (window as unknown as { __momentCollectionAnimationStarts?: number }).__momentCollectionAnimationStarts ?? 0)).toBe(1)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => { (window as unknown as { __momentCollectionAnimationStarts?: number }).__momentCollectionAnimationStarts = 0 })
  await page.getByRole('button', { name: /All categories/ }).click()
  await expect(page).not.toHaveURL(/category=/)
  await expect(results.locator('.moments-recent-feed')).toHaveAttribute('data-category-transition', 'true')
  await expect(results.locator('.moments-recent-feed')).toHaveCSS('animation-name', 'none')
  await expect.poll(() => page.evaluate(() => (window as unknown as { __momentCollectionAnimationStarts?: number }).__momentCollectionAnimationStarts ?? 0)).toBe(0)
})

test('exact moment source, device save, reload and legacy session link', async ({ page }) => {
  const exactRefreshes: string[] = []
  page.on('request', request => { if (request.url().includes('momentOffsetSeconds=')) exactRefreshes.push(request.url()) })
  await installHubUxMock(page, { firstMomentHandoffRef: 'cr_c3RhbGU' })
  await installNewsroomMock(page)
  await page.goto('/analytics/moments')
  await expect(page.locator('.moments-result')).toHaveCount(2)
  await page.locator('.moments-result').first().getByRole('button', { name: 'Open moment' }).click()
  await expect(page.getByRole('link', { name: /^Watch at/ })).toHaveAttribute('href', 'https://www.twitch.tv/videos/123456?t=120s')
  const prepare = page.getByRole('link', { name: /Prepare clip in ReplayForge/ })
  if (process.env.VITE_REPLAYFORGE_UI_ORIGIN) {
    await expect(prepare).toHaveAttribute('href', `${process.env.VITE_REPLAYFORGE_UI_ORIGIN}/handoff/streampulse/cr_Y2NfYWJj`)
    await expect(prepare).not.toHaveAttribute('href', /cr_c3RhbGU/)
  } else {
    await expect(prepare).toHaveCount(0)
  }
  await page.locator('.moments-detail').getByRole('button', { name: 'Save on this device', exact: true }).click()
  await page.getByRole('button', { name: 'Saved (1)', exact: true }).click()
  await expect(page.locator('.moments-collection-scope > summary')).toHaveText('On this device · not synced')
  const savedResult = page.locator('.moments-result')
  const savedMeasurement = savedResult.locator('.moments-reaction-visual__metric')
  await expect(savedMeasurement.getByText('Chat / min', { exact: true })).toBeVisible()
  await expect(savedMeasurement.getByText('393', { exact: true })).toBeVisible()
  await expect(savedMeasurement.getByText('Emotes / min', { exact: true })).toBeVisible()
  await expect(savedMeasurement.getByText('133', { exact: true })).toBeVisible()
  await expect(savedResult).toContainText('DinoDance')
  await expect(savedResult.getByText('Time unavailable', { exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.moments-result')).toHaveCount(1)
  await expect(savedMeasurement.getByText('Chat / min', { exact: true })).toBeVisible()
  await expect(savedMeasurement.getByText('393', { exact: true })).toBeVisible()
  await expect(savedMeasurement.getByText('Emotes / min', { exact: true })).toBeVisible()
  await expect(savedMeasurement.getByText('133', { exact: true })).toBeVisible()
  await expect(savedResult.locator('.moments-reaction-visual img').first()).toHaveAttribute(
    'src',
    /cdn\.7tv\.app\/emote\/01GAM8EFQ00004MXFXAJYKA860/,
  )
  await page.locator('.moments-result').getByRole('button', { name: 'Open moment' }).click()
  await expect(page.getByRole('link', { name: /^Watch at/ })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Selected moment reactions' }).locator('img')).toHaveAttribute(
    'src',
    /cdn\.7tv\.app\/emote\/01GAM8EFQ00004MXFXAJYKA860/,
  )
  await expect.poll(() => exactRefreshes.some(url => new URL(url).searchParams.get('momentOffsetSeconds') === '120')).toBe(true)
  if (process.env.VITE_REPLAYFORGE_UI_ORIGIN) {
    await expect(page.getByRole('link', { name: /Prepare clip in ReplayForge/ })).toHaveAttribute('href', `${process.env.VITE_REPLAYFORGE_UI_ORIGIN}/handoff/streampulse/cr_Y2NfYWJj`)
  } else {
    await expect(page.getByRole('link', { name: /Prepare clip in ReplayForge/ })).toHaveCount(0)
  }
  expect(await page.evaluate(() => localStorage.getItem('streampulse.saved-moments.v2'))).not.toContain('handoffRef')
  await page.goto('/analytics/newsroom/story-xqc?window=live#keep')
  await expect(page).toHaveURL(/analytics\/explore\/story-xqc\?window=live#keep/)
  // Current master's legacy redirect remains owned by Explorer. Moments has
  // its own explicit session URL and does not take over that existing route.
  await expect(page.getByRole('heading', { name: 'Pulse Explorer', exact: true })).toBeVisible()
  await page.goto('/analytics/moments?view=sessions&story=story-xqc&window=live#keep')
  await expect(page.locator('.moments-result')).toHaveCount(1)
  await page.locator('.moments-result').getByRole('button', { name: 'Open moment' }).click()
  await expect(page.locator('.moments-detail h2')).toBeFocused()
  await expect(page.getByRole('region', { name: 'Selected moment reactions' })).toContainText('KEKW')
  await expect(page.getByRole('region', { name: 'Selected moment reactions' })).toContainText('80 uses')
  await page.keyboard.press('Escape')
  await expect(page.locator('.moments-result').getByRole('button', { name: 'Open moment' })).toBeFocused()
})

test('category survives detail and browser back; unsupported history stays honest', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __DISCOVERY_CATALOGUE_ENABLED__?: boolean }).__DISCOVERY_CATALOGUE_ENABLED__ = false
  })
  const historyReads: string[] = []
  page.on('request', request => { if (request.url().includes('/v1/public/discovery')) historyReads.push(request.url()) })
  await page.goto('/analytics/moments')
  await page.locator('.moments-category-track').getByRole('button', { name: /Minecraft/ }).click()
  await expect(page.locator('.moments-result')).toHaveCount(1)
  await page.locator('.moments-result').getByRole('button', { name: 'Open moment' }).click()
  await page.goBack()
  await expect(page.locator('.moments-category-track').getByRole('button', { name: /Minecraft/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.moments-result')).toHaveCount(1)
  await expect(page.locator('.moments-result').getByRole('button', { name: 'Open moment' })).toBeFocused()
  await page.goto('/analytics/moments?view=sessions&window=7d')
  await expect(page.getByText('7d session history is not enabled in this deployment.')).toBeVisible()
  const history = page.getByRole('button', { name: 'Stored history', exact: true })
  await expect(history).toBeEnabled()
  await history.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/collection=history/)
  await expect(history).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('heading', { name: 'Stored history is not available yet' })).toBeVisible()
  await expect(page.getByText(/No history data is requested/)).toBeVisible()
  await expect(page.locator('.discovery-calendar')).toHaveCount(0)
  await expect(page.getByText(/No indexed detections/)).toHaveCount(0)
  expect(historyReads).toEqual([])
  await page.getByRole('button', { name: 'Return to recent moments' }).click()
  await expect(page.locator('.moments-result')).toHaveCount(2)
})

test('Saved gallery keeps readable metadata and distinct neutral surface layers', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/analytics/moments')
  await expect(page.locator('.moments-result').first()).toBeVisible()

  await page.locator('.moments-result').first().getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: 'Saved (1)', exact: true }).click()
  await expect(page.locator('.moments-result--gallery')).toHaveCount(1)

  const audit = await page.evaluate(() => {
    const rgba = (value: string) => {
      const parts = value.match(/[\d.]+/g)?.map(Number) ?? []
      return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 }
    }
    const composite = (foreground: ReturnType<typeof rgba>, background: ReturnType<typeof rgba>) => ({
      r: foreground.r * foreground.a + background.r * (1 - foreground.a),
      g: foreground.g * foreground.a + background.g * (1 - foreground.a),
      b: foreground.b * foreground.a + background.b * (1 - foreground.a),
      a: 1,
    })
    const luminance = (color: ReturnType<typeof rgba>) => {
      const channel = (value: number) => {
        const unit = value / 255
        return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
    }
    const contrast = (a: ReturnType<typeof rgba>, b: ReturnType<typeof rgba>) => {
      const first = luminance(a)
      const second = luminance(b)
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
    }
    const result = document.querySelector<HTMLElement>('.moments-result')!
    const metadata = result.querySelector<HTMLElement>('small')!
    const reaction = result.querySelector<HTMLElement>('.moments-reaction-visual')!
    const category = document.querySelector<HTMLElement>('.moments-category-track > button[data-category-action="category"]')!
    const workspace = document.querySelector<HTMLElement>('.moments-workspace')!
    const resultBackground = rgba(getComputedStyle(result).backgroundColor)
    const text = composite(rgba(getComputedStyle(metadata).color), resultBackground)
    return {
      metadataContrast: contrast(text, resultBackground),
      workspaceBackground: getComputedStyle(workspace).backgroundColor,
      resultBackground: getComputedStyle(result).backgroundColor,
      reactionBackground: getComputedStyle(reaction).backgroundColor,
      categoryBackground: getComputedStyle(category).backgroundColor,
    }
  })

  expect(audit.metadataContrast).toBeGreaterThanOrEqual(4.5)
  expect(audit.resultBackground).not.toBe(audit.workspaceBackground)
  expect(audit.reactionBackground).not.toBe(audit.resultBackground)
  expect(audit.categoryBackground).toBe('rgba(0, 0, 0, 0)')
})

test('creator navigation opens stored history and Back restores browse filters', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __DISCOVERY_CATALOGUE_ENABLED__?: boolean }).__DISCOVERY_CATALOGUE_ENABLED__ = true
  })
  await page.route('**/v1/public/discovery**', route => route.fulfill({ status: 404, json: {} }))
  await page.goto('/analytics/moments')
  await page.locator('.moments-category-track').getByRole('button', { name: /Minecraft/ }).click()
  await expect(page.locator('.moments-result')).toHaveCount(1)
  const creator = page.locator('.moments-result').getByRole('link', { name: /^Browse .* history$/ })
  const href = await creator.getAttribute('href')
  expect(href).toContain('collection=history&creator=')
  await creator.click()
  await expect(page).toHaveURL(new RegExp('collection=history&creator='))
  await expect(page.getByRole('button', { name: 'Year overview', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Year overview is unavailable on this server. Month browsing remains separate.')).toBeVisible()
  await expect(page.locator('.discovery-year__grid')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)
  await expect(page.locator('.moments-detail')).toHaveCount(0)
  await page.goBack()
  await expect(page.locator('.moments-category-track').getByRole('button', { name: /Minecraft/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.moments-result')).toHaveCount(1)
  await expect(creator).toBeFocused()
})

test('in-page Back does not leave a detail entry that browser Back reopens', async ({ page }) => {
  await page.goto('/analytics')
  await page.getByRole('navigation', { name: 'Analytics navigation' }).getByRole('link', { name: 'Moments', exact: true }).click()
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

test('archive start keeps automatic preview and exact zero timestamp', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/analytics/moments?login=xqc&stream=s1&offset=0')
  await expect(page.getByRole('link', { name: /^Watch at/ })).toHaveAttribute('href', 'https://www.twitch.tv/videos/123456?t=0s')
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
  await page.addInitScript(() => localStorage.setItem('streampulse.saved-moments.v2', 'malformed'))
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
  await expect(page.getByRole('link', { name: /^Watch at/ })).toBeVisible()
  // Dev StrictMode may abort/re-run selection effects. Gallery navigation must
  // issue zero additional requests relative to the completed selected review.
  const selectedChecks = checks
  expect(selectedChecks).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Back to results' }).click()
  await expect(page.locator('.moments-card-artwork')).toHaveCount(1)
  await expect(page.locator('.moments-result').first().locator('.moments-card-artwork img')).toHaveAttribute('src', artwork.url)
  await expect(page.locator('.moments-result').nth(1).locator('.moments-card-artwork')).toHaveCount(0)
  expect(checks).toBe(selectedChecks)
  await page.locator('.moments-result').first().getByRole('button', { name: 'Twitch emote spike — Open moment for xQc at 2:00', exact: true }).click()
  await expect(page.getByRole('link', { name: /^Watch at/ })).toHaveAttribute('href', 'https://www.twitch.tv/videos/123456?t=120s')
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
  await first.locator('.moments-recent-artwork summary').click()
  await expect(first.locator('.moments-card-artwork')).toBeVisible()
  expect(sourceChecks).toBe(0)
  await first.locator('[data-discovery-key]').click()
  await expect(page.getByText('archive unavailable', { exact: false })).toBeVisible()
  expect(sourceChecks).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Back to results' }).click()
  await expect(first.locator('.moments-card-artwork')).toHaveCount(0)
})

test('Recent rows keep evidence, keyboard, Save, and analytics interactions independent', async ({ page }) => {
  await page.goto('/analytics/moments')
  const first = page.locator('.moments-result').first()
  await expect(first).toHaveAttribute('aria-label', 'xQc Twitch emote spike at 2:00')
  await expect(first.locator('.moments-reaction-visual, .moments-gallery-media')).toHaveCount(0)
  await expect(first.locator('iframe')).toHaveCount(0)
  const primary = first.getByRole('button', { name: 'Twitch emote spike — Open moment for xQc at 2:00', exact: true })
  await expect(primary).toContainText('Twitch emote spike')
  await expect(first.locator('.moments-row-emotes > span').first()).toHaveAttribute('title', /123 uses/)
  await expect(first.locator('.moments-row-emotes > span').nth(1)).toHaveAttribute('title', /10 uses/)
  await expect(first.locator('.moments-recent-rates')).toContainText('chat/min')
  await expect(page.locator('.moments-feed-scope')).toContainText('bounded to 10 at a time')
  await expect(page.locator('.moments-feed-scope')).toContainText('Sorting and filters apply only to this loaded snapshot, not missing history.')
  await expect(primary).not.toHaveAttribute('aria-pressed')
  await expect(first.locator('.moments-row-emotes')).toHaveCount(1)
  const emote = first.locator('.moments-row-emotes > span').first()
  await emote.hover()
  await expect(emote).toHaveAttribute('title', /DinoDance/)
  await emote.click()
  await expect(page.locator('.moments-detail')).toHaveCount(0)
  await primary.click()
  await expect(page.locator('.moments-detail')).toBeVisible()
  await expect(primary).toHaveAttribute('aria-current', 'true')
  await expect(first.locator('.moments-row-emotes')).toHaveCount(1)
  await expect(first.locator('.moments-reaction-visual')).toHaveCount(0)
  await page.getByRole('button', { name: 'Back to results' }).click()

  await first.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.moments-detail')).toHaveCount(0)

  const evidence = await first.locator('.moments-recent-rates').boundingBox()
  expect(evidence).not.toBeNull()
  await page.mouse.click(evidence!.x + evidence!.width / 2, evidence!.y + evidence!.height / 2)
  await expect(page.locator('.moments-detail')).toHaveCount(0)

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
  const cacheState = await page.evaluate(() => Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter((key): key is string => Boolean(key?.startsWith('sp:publicHubRecentMoments:v1:'))).map(key => ({ key, value: JSON.parse(localStorage.getItem(key) || '{}') })))
  expect(cacheState, JSON.stringify(cacheState)).not.toHaveLength(0)
  await installHubUxMock(page, { mode: 'empty', hubDelayMs: 700 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText('No available moments.')).toHaveCount(0, { timeout: 500 })
  await expect(page.locator('.moments-result')).toHaveCount(2, { timeout: 500 })
  await expect(page.getByText('No available moments.')).toBeVisible({ timeout: 3_000 })
  await expect(page.locator('.moments-result')).toHaveCount(0)
})

test('mobile session review loads earlier detections without replacing its selected source',async({page})=>{
  await page.setViewportSize({width:390,height:960})
  const body=newsroomFixture('ready','story-xqc')
  const first=body.story!.leadUpdate
  const second={...first,id:'earlier-update',headline:'Earlier reaction',detectorEventKey:'earlier-episode',occurredAt:new Date(Date.parse(first.occurredAt)-60000).toISOString(),momentRef:{...first.momentRef,occurrenceAt:first.momentRef.occurrenceAt-60000,publicMomentId:'earlier-moment',offsetSeconds:180}}
  second.comparison={...first.comparison,eventAt:first.comparison.eventAt-60000,baselineWindow:{...first.comparison.baselineWindow,start:first.comparison.baselineWindow.start-60000,end:first.comparison.baselineWindow.end-60000},evidence:{...first.comparison.evidence,metadataSampledAt:first.comparison.evidence.metadataSampledAt-60000}}
  second.evidence=second.comparison.evidence
  await page.route('**/v1/public/newsroom/story-xqc?*',route=>{
    const cursor=new URL(route.request().url()).searchParams.get('cursor')
    return route.fulfill({json:{...body,updates:cursor?[second]:[first],nextCursor:cursor?undefined:'earlier'}})
  })
  await page.goto('/analytics/moments?view=sessions&story=story-xqc')
  await page.locator('[data-discovery-key]').first().click()
  const selectedUrl=page.url()
  await page.getByRole('region',{name:'Continue reviewing collection'}).getByRole('button',{name:'Load more moments into review'}).click()
  const nav=page.getByRole('navigation',{name:'Review loaded moments'})
  await expect(nav).toContainText('1 of 2 loaded matches')
  await expect(page).toHaveURL(selectedUrl)
  await nav.getByRole('button',{name:'Next moment',exact:true}).click()
  await expect(page.getByRole('link',{name:/^Watch at/})).toHaveAttribute('href','https://www.twitch.tv/videos/123456?t=180s')
  await expect(page.locator('.moments-detail h2')).toHaveText('Earlier reaction')
})

test('second and third session detections keep their own source offsets without background index reads', async ({ page }) => {
  let indexReads = 0
  page.on('request', request => { if (/\/v1\/public\/newsroom\?/.test(request.url())) indexReads++ })
  await page.route('**/v1/public/newsroom/story-xqc?*', async route => {
    const body = newsroomFixture('ready', 'story-xqc')
    const first = body.story!.leadUpdate
    body.updates = [first, { ...first, id: 'second-update', headline: 'Second reaction', detectorEventKey: 'second-episode', momentRef: { ...first.momentRef, publicMomentId: 'second-moment', offsetSeconds: 360 } }, { ...first, id: 'third-update', headline: 'Third reaction', detectorEventKey: 'third-episode', momentRef: { ...first.momentRef, publicMomentId: 'third-moment', offsetSeconds: 540 } }]
    await route.fulfill({ json: body })
  })
  await page.goto('/analytics/moments?view=sessions&story=story-xqc')
  await expect(page.locator('.moments-result')).toHaveCount(3)
  await page.locator('.moments-result').filter({ hasText: 'Second reaction' }).getByRole('button', { name: 'Open moment' }).click()
  await expect(page.getByRole('link', { name: /^Watch at/ })).toHaveAttribute('href', 'https://www.twitch.tv/videos/123456?t=360s')
  await page.locator('.moments-detail').getByRole('button', { name: 'Back to results' }).click()
  await page.locator('.moments-result').filter({ hasText: 'Third reaction' }).getByRole('button', { name: 'Open moment' }).click()
  await expect(page.getByRole('link', { name: /^Watch at/ })).toHaveAttribute('href', 'https://www.twitch.tv/videos/123456?t=540s')
  expect(indexReads).toBe(0)
})

test('unavailable exact source remains saveable and recovery does not substitute another stream', async ({ page }) => {
  let available = false
  await page.route('**/v1/portal/analytics/streams/*', route => route.fulfill({ json: { vodTiming: { state: 'verified' }, vodDurationSeconds: 18000, vodAlignSeconds: 0, channel: 'xqc', stream: { streamId: available ? 's1' : 'other', vodId: '123456' } } }))
  await page.goto('/analytics/moments?login=xqc&stream=s1&offset=9999')
  await expect(page.getByText('Saved metadata is historical.', { exact: false })).toHaveCount(0)
  await expect(page.getByText('Source identity could not be confirmed. No substitute stream was selected.')).toBeVisible()
  await expect(page.getByRole('link', { name: /^Watch at/ })).toHaveCount(0)
  await page.locator('.moments-detail').getByRole('button', { name: 'Save on this device', exact: true }).click()
  available = true
  await page.locator('.moments-detail').getByRole('button', { name: 'Recheck source' }).click()
  await expect(page.getByRole('link', { name: /^Watch at/ })).toHaveAttribute('href', 'https://www.twitch.tv/videos/123456?t=9999s')
  await page.getByRole('button', { name: 'Saved (1)', exact: true }).click()
  await page.locator('.moments-result').getByRole('button', { name: 'Saved', exact: true }).click()
  await expect(page.getByText('No available moments.')).toBeVisible()
})

test('session Back restores originating session focus', async ({ page }) => {
  await page.goto('/analytics/moments?view=sessions')
  const session = page.locator('[data-story-id="story-xqc"]')
  await session.click()
  await expect(page.locator('.moments-result')).toHaveCount(1)
  await page.goBack()
  await expect(session).toBeFocused()
})

test('loaded search, occurrence and ordering survive exact-detail Back and refresh', async ({ page }) => {
  await page.goto('/analytics/moments')
  await selectPulseOption(page, 'Result sort order', 'Category A–Z')
  await selectPulseOption(page, 'Occurrence time window', 'Last 24 hours')
  await page.getByLabel('Find loaded moments').fill('xqc')
  await expect(page.locator('.moments-result')).toHaveCount(1)
  await expect(page.locator('.moments-feed-scope')).toContainText('Sorting and filters apply only to this loaded snapshot, not missing history.')
  await page.locator('.moments-result').getByRole('button', { name: 'Open moment' }).click()
  await expect(page.getByRole('link', { name: /^Watch at/ })).toHaveAttribute('href', 'https://www.twitch.tv/videos/123456?t=120s')
  await page.goBack()
  await expect(page.getByLabel('Find loaded moments')).toHaveValue('xqc')
  await expect(page.locator('.moments-result').getByRole('button', { name: 'Open moment' })).toBeFocused()
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Result sort order' })).toContainText('Category')
  await expect(page.getByRole('combobox', { name: 'Occurrence time window' })).toContainText('Last 24 hours')
  await expect(page.locator('.moments-result')).toHaveCount(1)
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(page.getByLabel('Find loaded moments')).toHaveValue('')
  await expect(page.getByRole('combobox', { name: 'Result sort order' })).toContainText('Newest first')
  await expect(page.getByRole('combobox', { name: 'Occurrence time window' })).toContainText('Any loaded time')
  await expect(page.locator('.moments-result')).toHaveCount(2)
})

test('custom UTC dates validate and filter without requesting invented history', async ({ page }) => {
  const reads: string[] = []
  page.on('request', request => { if (/\/v1\/public\/hub\?/.test(request.url())) reads.push(request.url()) })
  await page.goto('/analytics/moments')
  await expect(page.locator('.moments-result')).toHaveCount(2)
  await selectPulseOption(page, 'Occurrence time window', 'Custom dates (UTC)')
  await expect(page.getByText('Choose valid From and Through dates (UTC).')).toBeVisible()
  const today = new Date().toISOString().slice(0, 10)
  await page.getByLabel('From date UTC').fill(new Date(Date.now() - 86_400_000).toISOString().slice(0, 10))
  await page.getByLabel('Through date UTC').fill(today)
  await expect(page.locator('.moments-result')).toHaveCount(2)
  await page.getByLabel('From date UTC').fill('2099-01-01')
  await expect(page.getByText('From must be on or before Through.')).toBeVisible()
  await expect(page.locator('.moments-result')).toHaveCount(0)
  expect(reads.every(url => new URL(url).searchParams.get('activityWindow') === '30m')).toBe(true)
})

test('session summary filtering keeps its scope and category through selection', async ({ page }) => {
  await page.goto('/analytics/moments?view=sessions')
  await expect(page.locator('[data-story-id]')).toHaveCount(3)
  await selectPulseOption(page, 'Filter category', 'Just Chatting')
  await page.getByLabel('Find loaded moments').fill('xqc')
  await expect(page.locator('[data-story-id]')).toHaveCount(1)
  await expect(page.getByText('summary-detection timestamps/categories', { exact: false })).toBeVisible()
  await page.locator('[data-story-id="story-xqc"]').click()
  await expect(page.locator('.moments-result')).toHaveCount(1)
  await page.goBack()
  await expect(page.getByLabel('Find loaded moments')).toHaveValue('xqc')
  await expect(page.locator('[data-story-id="story-xqc"]')).toBeFocused()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('.moments-tab-indicator')).toHaveCSS('transition-duration', '0s')
})

test('selected verified preview loads automatically without autoplay and retains close/mobile controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.route('https://player.twitch.tv/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Player contract fixture</p>' }))
  await page.goto('/analytics/moments?login=xqc&stream=s1&offset=120')
  await expect(page.getByRole('button', { name: /Load Twitch preview/ })).toHaveCount(0)
  // Automatic media loading must not steal focus from the selected-moment heading.
  await expect(page.locator('.moments-detail h2')).toBeFocused()
  const frame = page.getByTitle('Selected moment Twitch VOD preview')
  await expect(frame).toHaveAttribute('src', /video=v123456&time=120s&parent=127.0.0.1&autoplay=false/)
  // A matching src alone passed while the document CSP blocked every real preview.
  await expect(page.frameLocator('iframe[title="Selected moment Twitch VOD preview"]').getByText('Player contract fixture')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Watch at 2:00 on Twitch' })).toHaveCount(1)
  await expect(page.getByRole('link', { name: 'Watch at 2:00 on Twitch' })).toHaveAttribute('href', 'https://www.twitch.tv/videos/123456?t=120s')
  await page.getByRole('button', { name: 'Close preview', exact: true }).click()
  await expect(page.getByRole('button', { name: /Load Twitch preview/ })).toBeFocused()
  await expect(frame).toHaveCount(0)
  await page.getByRole('button', { name: /Load Twitch preview/ }).click()
  await expect(frame).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Close preview', exact: true })).toBeFocused()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(frame).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Watch at 2:00 on Twitch' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Watch at 2:00 on Twitch' })).toBeFocused()
  const mobileTargets = page.locator('.moment-vod-preview__fallback a, .moments-detail summary')
  expect(await mobileTargets.count()).toBeGreaterThan(1)
  for (const target of await mobileTargets.all()) {
    expect((await target.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  }
})

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`creator activity overview fits ${width}px and opens an exact UTC day`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 })
    await page.addInitScript(() => {
      ;(window as unknown as { __DISCOVERY_CATALOGUE_ENABLED__?: boolean }).__DISCOVERY_CATALOGUE_ENABLED__ = true
    })
    // Synthetic, internally consistent activity and detections, not real creator history.
    const items = [
      { streamId: 'synthetic-a', offsetSeconds: 90000, at: Date.parse('2025-09-02T12:00:00Z'), chatPerMin: 50, label: 'Synthetic late detection with a deliberately long descriptive label for wrapping' },
      { streamId: 'synthetic-b', offsetSeconds: 0, at: Date.parse('2025-09-02T11:00:00Z'), chatPerMin: 40, label: 'Synthetic second broadcast at zero offset' },
      { streamId: 'synthetic-a', offsetSeconds: 82800, at: Date.parse('2025-09-02T10:00:00Z'), chatPerMin: 30, label: 'Synthetic earlier detection' },
      { streamId: 'synthetic-a', offsetSeconds: 79200, at: Date.parse('2025-09-02T09:00:00Z'), chatPerMin: 60, label: 'Synthetic continuation' },
    ].map((item, index) => ({ ...item, id: `dm_${String(index + 1).padStart(32, '0')}`, login: 'ohnepixel', source: 'stored_irc', revision: 1,
      emotesPerMin: 5, categorySource: 'unavailable', topEmotes: [{ name: 'SyntheticReaction', count: 5 }] }))
    const days = Array.from({ length: 365 }, (_, index) => {
      const day = new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10)
      const measured = day === '2025-09-02'
      return { day, state: measured ? 'measured' : 'no_measurement', coverage: measured ? 'partial' : 'none',
        streams: measured ? 2 : 0, measuredStreamMinutes: measured ? 4 : 0,
        chatMessages: measured ? 180 : null, emoteUses: measured ? 20 : null, detections: measured ? 4 : null }
    })
    let failContinuation = true
    let yearReads = 0
    const cursors: string[] = []
    await page.route('**/v1/channels/ohnepixel', route => route.fulfill({ json: { login: 'ohnepixel' } }))
    await page.route('**/v1/portal/analytics/streams/synthetic-*', route => {
      const streamId = new URL(route.request().url()).pathname.split('/').pop()
      return route.fulfill({ json: { channel: 'ohnepixel', stream: { streamId }, availability: { vodState: 'unavailable' } } })
    })
    await page.route('**/v1/public/discovery**', route => {
      const params = new URL(route.request().url()).searchParams
      const year = params.get('year')
      if (year) yearReads++
      const month = params.get('month') || '2025-09'
      const cursor = params.get('cursor') || ''
      if (cursor) {
        cursors.push(cursor)
        if (failContinuation) return route.fulfill({ status: 503, json: {} })
      }
      return route.fulfill({ json: { schemaVersion: 1, state: 'ready', scope: 'indexed_public_irc_streams',
        calendarScope: year ? 'year_and_creator_only' : 'month_and_creator_only', ...(year ? { year } : { month }),
        login: 'ohnepixel', asOf: '2026-09-05T12:00:00Z', projectionUpdatedAt: null, dataThrough: null,
        days: year ? days : days.filter(day => day.day.startsWith(month)), items: year ? [] : cursor ? [items[2], items[3]] : items.slice(0, 3), nextCursor: year || cursor ? '' : 'synthetic-page2' } })
    })
    await page.goto('/analytics/moments?view=recent&collection=history&creator=ohnepixel&calendar=year&year=2025&month=2025-09')
    await expect(page.getByRole('heading', { name: '@ohnepixel', exact: true })).toBeVisible()
    const grid = page.locator('.discovery-year__grid')
    await expect(grid.locator('button')).toHaveCount(365)
    expect(await grid.locator('button[tabindex="0"]').count()).toBe(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.screenshot({ path: info.outputPath(`creator-history-${width}.png`), fullPage: true })
    await page.getByText('More calendar options', { exact: true }).click()
    await page.getByLabel('Year overview day').fill('2025-09-02')
    await page.getByRole('button', { name: 'Open day', exact: true }).click()
    await expect(page).toHaveURL(/day=2025-09-02/)
    await expect(page.getByRole('button', { name: /^2025-09-02:/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'Year overview', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByText('More calendar options', { exact: true }).click()
    await expect(grid.locator('button')).toHaveCount(365)
    const groups = page.locator('.moments-broadcast-group')
    await expect(groups).toHaveCount(2)
    await expect(groups.first().locator('.moments-result')).toHaveCount(2)
    await expect(groups.first().locator('.moments-broadcast-count')).toHaveText('2 loaded matching detections')
    for (const group of await groups.all()) {
      const heading = await group.locator('.moments-broadcast-heading').boundingBox()
      const cards = await group.locator('.moments-result-list').boundingBox()
      expect(heading!.y + heading!.height).toBeLessThanOrEqual(cards!.y)
    }
    const keys = () => page.locator('[data-discovery-key]').evaluateAll(elements => elements.map(element => JSON.parse(element.getAttribute('data-discovery-key')!)))
    expect(await keys()).toEqual([['ohnepixel', 'synthetic-a', 90000], ['ohnepixel', 'synthetic-a', 82800], ['ohnepixel', 'synthetic-b', 0]])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.screenshot({ path: info.outputPath(`creator-day-${width}.png`), fullPage: true })
    await topViewport(page)
    await recordComposition(page, `creator-day-${width}.png`)
    await page.screenshot({ path: info.outputPath(`creator-day-viewport-${width}.png`) })
    if (width === 1440) await expectInFirstViewport(page, '.discovery-calendar__heading, .discovery-year__row, .moments-results-heading, .moments-broadcast-group:first-child .moments-result:first-child')
    if (width === 390) {
      await expectInFirstViewport(page, '.discovery-calendar__heading, .discovery-calendar__modes')
      expect.soft((await groups.first().boundingBox())!.y, 'first day broadcast begins above fold').toBeLessThan(960)
      const broadcastHeading = (await groups.first().locator('.moments-broadcast-heading h3').boundingBox())!
      expect.soft(broadcastHeading.y + broadcastHeading.height,
        'visible first broadcast identity, not just its empty container edge').toBeLessThanOrEqual(960)
      for (const selector of ['.moments-filter-note', '.moments-broadcast-scope']) {
        const disclosure = page.locator(selector)
        await disclosure.locator('summary').focus()
        const box = (await disclosure.boundingBox())!
        expect.soft(box.width, `${selector} must not be an invisible keyboard stop`).toBeGreaterThanOrEqual(24)
        expect.soft(box.height, `${selector} must not be clipped on focus`).toBeGreaterThanOrEqual(24)
      }
    }
    await page.locator('[data-discovery-key]').first().click()
    await expect(page.locator('.moments-calendar-context')).toBeHidden()
    // Hidden but mounted calendars must reject focus even when year data finishes late.
    await page.locator('.discovery-year__grid button:not([disabled])').first().evaluate((node: HTMLButtonElement) => node.focus())
    expect(await page.locator('.moments-calendar-context').evaluate(node => node.contains(document.activeElement))).toBe(false)
    await expect(page.getByRole('navigation', { name: 'Creator day return context' })).toContainText('2025-09-02')
    const detail = page.locator('.moments-detail')
    const navigation = page.getByRole('navigation', { name: 'Review loaded moments' })
    await navigation.getByRole('button', { name: 'Next moment' }).click()
    await expect(page).toHaveURL(/stream=synthetic-a&offset=82800/)
    await navigation.getByRole('button', { name: 'Next moment' }).click()
    await expect(page).toHaveURL(/stream=synthetic-b&offset=0/)
    await navigation.getByRole('button', { name: 'Previous moment' }).click()
    await expect(page).toHaveURL(/stream=synthetic-a&offset=82800/)
    const selectedUrl = page.url()
    const continuation = page.getByRole('region', { name: 'Continue reviewing collection' })
    await continuation.getByRole('button', { name: 'Load more moments into review' }).click()
    await expect(continuation.getByRole('status')).toContainText('More results could not be loaded')
    await expect(page).toHaveURL(selectedUrl)
    await captureSyntheticWorkflow(page, info.outputPath(`creator-pagination-error-${width}.png`))
    failContinuation = false
    await continuation.getByRole('button', { name: 'Load more moments into review' }).click()
    await expect(navigation).toContainText('2 of 4 loaded matches')
    await expect(groups).toHaveCount(2)
    await expect(groups.first().locator('.moments-result')).toHaveCount(3)
    await expect(page).toHaveURL(selectedUrl)
    // One failed GET plus its bounded automatic retry, then explicit continuation.
    expect(cursors).toEqual(['synthetic-page2', 'synthetic-page2', 'synthetic-page2'])
    await expect(detail.getByRole('button', { name: 'Recheck source' })).toBeVisible()
    await expect(detail.getByRole('link', { name: /^Watch at/ })).toHaveCount(0)
    await expect(detail.locator('iframe')).toHaveCount(0)
    await detail.getByRole('button', { name: 'Save on this device', exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    if (width > 850) {
      const queue = await page.locator('.moments-results').boundingBox()
      const review = await detail.boundingBox()
      expect(queue!.x + queue!.width).toBeLessThanOrEqual(review!.x)
    }
    await captureSyntheticWorkflow(page, info.outputPath(`creator-review-${width}.png`))
    await page.keyboard.press('Escape')
    await expect(page.locator('.moments-calendar-context')).toBeVisible()
    await expect(grid.locator('button')).toHaveCount(365)
    expect(yearReads, 'day selection, review and Back reuse the mounted year').toBe(1)
    await expect(page.locator('[data-discovery-key]').nth(1)).toBeFocused()
    await expect(page).toHaveURL(/day=2025-09-02/)
    await selectPulseOption(page, 'Result sort order', 'Highest chat/min')
    expect(await keys()).toEqual([['ohnepixel', 'synthetic-a', 79200], ['ohnepixel', 'synthetic-a', 90000], ['ohnepixel', 'synthetic-a', 82800], ['ohnepixel', 'synthetic-b', 0]])
    await expect(page.locator('.moments-broadcast-scope')).toContainText('not an aggregate broadcast score')
  })
}

for (const width of [390, 1440]) {
  test(`Sessions continuation retry and Saved removal preserve review identity at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 })
    await page.route('https://player.twitch.tv/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Synthetic player contract fixture, not footage</p>' }))
    const body = newsroomFixture('ready', 'story-xqc')
    const first = body.story!.leadUpdate
    const earlierAt = first.momentRef.occurrenceAt - 60000
    const second = { ...first, id: 'synthetic-earlier', headline: 'Synthetic earlier detection', occurredAt: new Date(earlierAt).toISOString(),
      momentRef: { ...first.momentRef, occurrenceAt: earlierAt, publicMomentId: 'synthetic-earlier', offsetSeconds: first.momentRef.offsetSeconds - 60 },
      comparison: { ...first.comparison, eventAt: earlierAt, baselineWindow: { ...first.comparison.baselineWindow, start: first.comparison.baselineWindow.start - 60000, end: first.comparison.baselineWindow.end - 60000 },
        evidence: { ...first.comparison.evidence, metadataSampledAt: earlierAt } } }
    second.evidence = second.comparison.evidence
    let fail = true
    const cursors: string[] = []
    await page.route('**/v1/public/newsroom/story-xqc?*', route => {
      const cursor = new URL(route.request().url()).searchParams.get('cursor')
      if (cursor) {
        cursors.push(cursor)
        if (fail) return route.fulfill({ status: 503, json: {} })
      }
      return route.fulfill({ json: { ...body, updates: cursor ? [second] : [first], nextCursor: cursor ? undefined : 'synthetic-earlier-page' } })
    })
    await page.goto('/analytics/moments?view=sessions')
    const session = page.locator('[data-story-id="story-xqc"]')
    await expect(session).toBeVisible()
    await captureSyntheticWorkflow(page, info.outputPath(`sessions-index-${width}.png`))
    await session.click()
    await expect(page.locator('[data-discovery-key]')).toHaveCount(1)
    await captureSyntheticWorkflow(page, info.outputPath(`session-detail-${width}.png`))
    await page.locator('[data-discovery-key]').click()
    const selectedUrl = page.url()
    const continuation = page.getByRole('region', { name: 'Continue reviewing collection' })
    await continuation.getByRole('button', { name: 'Load more moments into review' }).click()
    await expect(continuation.getByRole('status')).toBeVisible()
    await expect(page).toHaveURL(selectedUrl)
    fail = false
    await continuation.getByRole('button', { name: 'Load more moments into review' }).click()
    await expect(page.getByRole('navigation', { name: 'Review loaded moments' })).toContainText('1 of 2 loaded matches')
    await expect(page).toHaveURL(selectedUrl)
    expect(cursors).toEqual(['synthetic-earlier-page', 'synthetic-earlier-page', 'synthetic-earlier-page'])
    await page.locator('.moments-detail').getByRole('button', { name: 'Save on this device', exact: true }).click()
    await page.getByRole('button', { name: 'Back to results' }).click()
    await expect(page.locator('[data-discovery-key]').first()).toBeFocused()
    await page.goBack()
    await expect(session).toBeFocused()
    await page.getByRole('button', { name: 'Saved (1)', exact: true }).click()
    await page.reload()
    await expect(page.locator('.moments-result')).toHaveCount(1)
    await captureSyntheticWorkflow(page, info.outputPath(`saved-populated-${width}.png`))
    await page.locator('[data-discovery-key]').click()
    const savedUrl = page.url()
    await page.locator('.moments-detail').getByRole('button', { name: 'Saved on this device', exact: true }).click()
    await expect(page).toHaveURL(savedUrl)
    await expect(page.getByText('Selection outside loaded matches')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Next moment' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(page.locator('.moments-results h2')).toBeFocused()
    await expect(page.getByText('No available moments.', { exact: false })).toBeVisible()
    await page.reload()
    await expect(page.getByText('No available moments.', { exact: false })).toBeVisible()
    await expect(page.locator('.moments-result')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await captureSyntheticWorkflow(page, info.outputPath(`saved-empty-${width}.png`))
  })
}

for (const width of [390, 768, 1024, 1440]) {
  test(`flat workspace fits ${width}px with readable detail`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 })
    await page.route('https://player.twitch.tv/**', route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body style="margin:0;background:#101014;color:#999;font:13px sans-serif;display:grid;place-items:center;min-height:100vh">Twitch player test fixture</body></html>',
    }))
    await page.goto('/analytics/moments')
    await expect(page.locator('.moments-result')).toHaveCount(2)
    await expect(page.locator('.moments-gallery-media')).toHaveCount(0)
    await expect(page.locator('.moments-result--compact')).toHaveCount(2)
    await expect(page.locator('.moments-category-track')).toBeVisible()
    await expect(page.locator('.moments-category-disclosure')).toHaveCount(0)
    await expect(page.locator('[data-column="Event time"] small').first()).toContainText('into broadcast')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await expectStableSave(page, '.moments-result')
    await captureSyntheticWorkflow(page, info.outputPath(`moments-${width}.png`))
    await page.locator('.moments-result').first().getByRole('button', { name: 'Open moment' }).click()
    await expect(page.getByRole('link', { name: /^Watch at/ })).toBeVisible()
    await expect(page.locator('.moments-gallery-media')).toHaveCount(0)
    await expectStableSave(page, '.moments-detail')
    if (width > 850) {
      await expectStableSave(page, '.moments-result')
      const results = await page.locator('.moments-results').boundingBox()
      const detail = await page.locator('.moments-detail').boundingBox()
      expect(results).not.toBeNull()
      expect(detail).not.toBeNull()
      expect(results!.x + results!.width).toBeLessThanOrEqual(detail!.x)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    const heading = await page.locator('.moments-review-heading').boundingBox()
    const preview = await page.locator('.moment-vod-preview').boundingBox()
    const identity = await page.locator('.moments-detail > .moments-identity').boundingBox()
    const reactions = await page.locator('.moments-detail .moments-reactions').boundingBox()
    const actions = await page.locator('.moments-primary-actions').boundingBox()
    expect(heading!.y + heading!.height).toBeLessThanOrEqual(preview!.y)
    expect(preview!.y + preview!.height).toBeLessThanOrEqual(identity!.y)
    expect(reactions!.y + reactions!.height).toBeLessThanOrEqual(actions!.y)
    for (const name of ['Previous moment', 'Next moment']) {
      const control = page.getByRole('button', { name, exact: true })
      await expect(control).toHaveAttribute('title', name)
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(width <= 850 ? 44 : 36)
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    await page.screenshot({ path: info.outputPath(`detail-${width}.png`), fullPage: true })
    await page.screenshot({ path: info.outputPath(`detail-viewport-${width}.png`) })
  })
}
