import { expect, type Page } from '@playwright/test'

export async function scrollSceneToProgress(page: Page, progress: number): Promise<void> {
  const scene = page.locator('.sl-xtour__scene')
  await scene.waitFor({ state: 'attached', timeout: 15_000 })

  const viewport = page.viewportSize()?.height ?? 900
  const clamped = Math.min(1, Math.max(0, progress))

  const metrics = await scene.evaluate(el => {
    const html = el as HTMLElement
    return {
      top: html.getBoundingClientRect().top + window.scrollY,
      height: html.offsetHeight,
    }
  })

  const scrollable = Math.max(metrics.height - viewport, 1)
  const targetY = metrics.top + clamped * scrollable

  await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }), targetY)
  await page.evaluate(() => {
    window.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('resize'))
  })
  await page.waitForTimeout(400)
}

export async function scrollTourToStep(page: Page, step: number): Promise<void> {
  const progressByStep: Record<number, number> = {
    1: 0.06,
    2: 0.32,
    3: 0.58,
    4: 0.86,
  }
  await scrollSceneToProgress(page, progressByStep[step] ?? 0)
  await expect
    .poll(async () => page.locator('.sl-xtour').getAttribute('data-step'), { timeout: 12_000 })
    .toBe(String(step))
  await expect(page.locator(`.pulse-landing-tour-step[data-tour-step="${step}"].is-live`)).toBeVisible({
    timeout: 12_000,
  })
}

export async function assertPanelHasNoHorizontalOverflow(page: Page): Promise<void> {
  const scrollport = page.locator('.pulse-landing-panel .pulse-landing-scrollport')
  const overflow = await scrollport.evaluate(el => el.scrollWidth <= el.clientWidth + 1)
  expect(overflow).toBe(true)
}

export async function assertAnimatedTourHidesPanelScrollbar(page: Page): Promise<void> {
  const tour = page.locator('.sl-xtour')
  const isStatic = await tour.getAttribute('data-static')
  if (isStatic !== null) return

  const scrollport = page.locator('.pulse-landing-panel .pulse-landing-scrollport')
  const scroll = page.locator('.pulse-landing-panel .pulse-landing-scroll')

  const metrics = await scrollport.evaluate(el => ({
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
    scrollTop: el.scrollTop,
    overflowY: getComputedStyle(el).overflowY,
  }))
  expect(metrics.overflowY).toBe('hidden')
  expect(metrics.scrollHeight).toBeGreaterThanOrEqual(metrics.clientHeight)
  expect(metrics.scrollTop).toBe(0)

  const slExtScrollport = page.locator('.pulse-landing-panel .sl-ext__scrollport')
  const slExtOverflow = await slExtScrollport.evaluate(el => getComputedStyle(el).overflowY)
  expect(slExtOverflow).toBe('hidden')

  const virtualScroll = await scroll.evaluate(el => {
    const y = getComputedStyle(el).getPropertyValue('--panel-y').trim()
    return y === '' ? 0 : Number.parseFloat(y)
  })
  expect(Number.isFinite(virtualScroll)).toBe(true)
}
