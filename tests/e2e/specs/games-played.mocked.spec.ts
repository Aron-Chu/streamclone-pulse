import { test, expect } from '../helpers/testFixtures.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'
import { openTwitchChannel, spaNavigateUrlOnly } from '../helpers/mockTwitch.ts'

const ROOT_ID = 'streamclone-pulse-root'

async function waitForGamesPlayed(page: import('@playwright/test').Page): Promise<void> {
  await expect
    .poll(
      () => page.evaluate(rootId => {
        const root = document.getElementById(rootId)?.shadowRoot
        return Boolean(root?.querySelector('[data-games-played-track]'))
      }, ROOT_ID),
      { timeout: 20_000 },
    )
    .toBe(true)
}

async function setTrackWidth(
  page: import('@playwright/test').Page,
  width: number,
): Promise<void> {
  await page.evaluate(({ rootId, nextWidth }) => {
    const root = document.getElementById(rootId)?.shadowRoot
    const navigation = root?.querySelector('[data-games-played-navigation]') as HTMLElement | null
    if (!navigation) throw new Error('Games Played navigation shell not found')
    let style = root?.querySelector('style[data-games-played-test-width]') as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.setAttribute('data-games-played-test-width', 'true')
      root?.append(style)
    }
    style.textContent = `[data-games-played-navigation] { width: ${nextWidth}px !important; }`
  }, { rootId: ROOT_ID, nextWidth: width })
}

async function readGamesPlayedState(page: import('@playwright/test').Page) {
  return page.evaluate(rootId => {
    const root = document.getElementById(rootId)?.shadowRoot
    const track = root?.querySelector('[data-games-played-track]') as HTMLElement | null
    const header = root?.querySelector('[data-games-played-header]') as HTMLElement | null
    const label = root?.querySelector('[data-games-played-header] span') as HTMLElement | null
    const trail = root?.querySelector('[data-games-played-trail]') as HTMLElement | null
    const status = root?.querySelector('[data-games-played-status]') as HTMLElement | null
    const rightArrow = root?.querySelector('[data-games-played-arrow="next"]') as HTMLButtonElement | null
    const firstItem = track?.querySelector('[data-games-played-item]') as HTMLElement | null
    return {
      exists: Boolean(track),
      clientWidth: track?.clientWidth ?? 0,
      scrollWidth: track?.scrollWidth ?? 0,
      scrollLeft: track?.scrollLeft ?? 0,
      headerLeft: header?.getBoundingClientRect().left ?? 0,
      headerRight: header?.getBoundingClientRect().right ?? 0,
      labelLeft: label?.getBoundingClientRect().left ?? 0,
      trailLeft: trail?.getBoundingClientRect().left ?? 0,
      trailRight: trail?.getBoundingClientRect().right ?? 0,
      trailText: status?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      hasRightArrow: Boolean(rightArrow && !rightArrow.disabled),
      firstItemWidth: firstItem?.offsetWidth ?? 0,
      firstItemHeight: firstItem?.offsetHeight ?? 0,
      firstItemArt: firstItem?.querySelector('img')?.getAttribute('src') ?? null,
    }
  }, ROOT_ID)
}

async function hoverGamesPlayedChip(
  page: import('@playwright/test').Page,
  index: number,
): Promise<void> {
  await page.evaluate(({ rootId, chipIndex }) => {
    const root = document.getElementById(rootId)?.shadowRoot
    const items = root?.querySelectorAll('[data-games-played-item]')
    const el = items?.[chipIndex] as HTMLElement | undefined
    el?.focus()
  }, { rootId: ROOT_ID, chipIndex: index })
  await page.waitForTimeout(160)
}

test.describe('Games Played manual scrolling', () => {
  test('aligns the header, keeps movement manual, and contains wheel scrolling', async ({
    extension,
    prepare,
  }) => {
    await prepare({ scenario: 'games-rich', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await waitForGamesPlayed(extension.page)

    await setTrackWidth(extension.page, 600)
    await expect.poll(() => readGamesPlayedState(extension.page)).toMatchObject({
      exists: true,
      hasRightArrow: false,
    })
    const subChipState = await readGamesPlayedState(extension.page)
    expect(subChipState.trailText).toBe('Showing 8 of 8')
    expect(subChipState.trailText).not.toContain('more')
    await expect.poll(async () => (await readGamesPlayedState(extension.page)).firstItemArt)
      .toContain('509658-144x192.jpg')

    await setTrackWidth(extension.page, 300)
    await expect.poll(() => readGamesPlayedState(extension.page)).toMatchObject({
      hasRightArrow: true,
    })
    const initial = await readGamesPlayedState(extension.page)
    expect(initial.trailText).toBe('1–5 of 8')
    expect(initial.trailText).not.toContain('more')
    expect(initial.labelLeft).toBeLessThanOrEqual(initial.headerLeft + 1)
    expect(Math.abs(initial.trailRight - initial.headerRight)).toBeLessThanOrEqual(1)

    await extension.page.waitForTimeout(650)
    expect((await readGamesPlayedState(extension.page)).scrollLeft).toBe(initial.scrollLeft)

    const samples = await extension.page.evaluate(async rootId => {
      const root = document.getElementById(rootId)?.shadowRoot
      const track = root?.querySelector('[data-games-played-track]') as HTMLElement | null
      const button = root?.querySelector('[data-games-played-arrow="next"]') as HTMLButtonElement | null
      if (!track || !button) throw new Error('Games Played next arrow not found')

      const values = [track.scrollLeft]
      button.click()
      await new Promise<void>(resolve => {
        const startedAt = performance.now()
        const sample = (now: number) => {
          values.push(track.scrollLeft)
          if (now - startedAt >= 280) {
            resolve()
            return
          }
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
      return values
    }, ROOT_ID)
    expect(samples.length).toBeGreaterThan(3)
    expect(samples[samples.length - 1]).toBeGreaterThan(samples[0])
    expect(samples.every((value, index) => index === 0 || value >= samples[index - 1] - 1)).toBe(true)
    await expect.poll(async () => (await readGamesPlayedState(extension.page)).trailText).toBe('2–6 of 8')

    const wheel = await extension.page.evaluate(rootId => {
      const root = document.getElementById(rootId)?.shadowRoot
      const track = root?.querySelector('[data-games-played-track]') as HTMLElement | null
      const panel = root?.querySelector('[data-testid="pulse-panel-scroll"]') as HTMLElement | null
      if (!track || !panel) throw new Error('Games Played scroll containers not found')
      track.scrollLeft = 0
      const panelBefore = panel.scrollTop
      const event = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaMode: 1,
        deltaY: 1,
      })
      const dispatchResult = track.dispatchEvent(event)
      return {
        dispatchResult,
        defaultPrevented: event.defaultPrevented,
        panelBefore,
        panelAfter: panel.scrollTop,
        scrollLeft: track.scrollLeft,
      }
    }, ROOT_ID)
    expect(wheel.dispatchResult).toBe(false)
    expect(wheel.defaultPrevented).toBe(true)
    expect(wheel.panelAfter).toBe(wheel.panelBefore)
    expect(wheel.scrollLeft).toBeGreaterThan(0)
    expect(wheel.scrollLeft).toBeLessThanOrEqual(26)
  })

  test('keeps compact touch targets at narrow Twitch sidebar widths', async ({
    extension,
    prepare,
  }) => {
    await prepare({ scenario: 'games-rich', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await waitForGamesPlayed(extension.page)

    for (const width of [300, 320, 400]) {
      await setTrackWidth(extension.page, width)
      await expect.poll(() => readGamesPlayedState(extension.page)).toMatchObject({
        firstItemWidth: 52,
        firstItemHeight: 70,
      })
    }
  })

  test('keeps first and last cards clickable at the scroll boundaries', async ({
    extension,
    prepare,
  }) => {
    await extension.page.emulateMedia({ reducedMotion: 'reduce' })
    await prepare({ scenario: 'games-rich', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await waitForGamesPlayed(extension.page)
    await setTrackWidth(extension.page, 300)
    await expect.poll(() => readGamesPlayedState(extension.page)).toMatchObject({
      hasRightArrow: true,
    })

    const leftBoundary = await extension.page.evaluate(rootId => {
      const root = document.getElementById(rootId)?.shadowRoot
      const first = root?.querySelector('[data-games-played-item]') as HTMLElement | null
      const next = root?.querySelector('[data-games-played-arrow="next"]') as HTMLElement | null
      if (!first || !next) throw new Error('Games Played boundary nodes not found')
      const firstRect = first.getBoundingClientRect()
      const nextRect = next.getBoundingClientRect()
      return {
        firstRect: { left: firstRect.left, right: firstRect.right, top: firstRect.top, bottom: firstRect.bottom },
        nextRect: { left: nextRect.left, right: nextRect.right, top: nextRect.top, bottom: nextRect.bottom },
        overlap: firstRect.right > nextRect.left && firstRect.left < nextRect.right
          && firstRect.bottom > nextRect.top && firstRect.top < nextRect.bottom,
      }
    }, ROOT_ID)
    expect(leftBoundary.overlap).toBe(false)

    const first = extension.page.locator('[data-games-played-item]').first()
    const firstCenter = await extension.page.evaluate(rootId => {
      const root = document.getElementById(rootId)?.shadowRoot
      const item = root?.querySelector('[data-games-played-item]') as HTMLElement | null
      if (!item) throw new Error('First Games Played card not found')
      const rect = item.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    }, ROOT_ID)
    await extension.page.mouse.click(firstCenter.x, firstCenter.y)
    await expect(first).toHaveAttribute('aria-pressed', 'true')

    await extension.page.evaluate(rootId => {
      const root = document.getElementById(rootId)?.shadowRoot
      const track = root?.querySelector('[data-games-played-track]') as HTMLElement | null
      if (!track) throw new Error('Games Played track not found at end boundary')
      track.scrollTo({ left: track.scrollWidth - track.clientWidth, behavior: 'auto' })
    }, ROOT_ID)
    await expect.poll(() => readGamesPlayedState(extension.page)).toMatchObject({
      hasRightArrow: false,
    })

    const rightBoundary = await extension.page.evaluate(rootId => {
      const root = document.getElementById(rootId)?.shadowRoot
      const items = root?.querySelectorAll('[data-games-played-item]')
      const last = items?.[items.length - 1] as HTMLElement | undefined
      const previous = root?.querySelector('[data-games-played-arrow="previous"]') as HTMLElement | null
      if (!last || !previous) throw new Error('Games Played end boundary nodes not found')
      const lastRect = last.getBoundingClientRect()
      const previousRect = previous.getBoundingClientRect()
      return {
        lastRect: { left: lastRect.left, right: lastRect.right, top: lastRect.top, bottom: lastRect.bottom },
        previousRect: { left: previousRect.left, right: previousRect.right, top: previousRect.top, bottom: previousRect.bottom },
        overlap: lastRect.right > previousRect.left && lastRect.left < previousRect.right
          && lastRect.bottom > previousRect.top && lastRect.top < previousRect.bottom,
      }
    }, ROOT_ID)
    expect(rightBoundary.overlap).toBe(false)

    const last = extension.page.locator('[data-games-played-item]').last()
    const lastCenter = await extension.page.evaluate(rootId => {
      const root = document.getElementById(rootId)?.shadowRoot
      const items = root?.querySelectorAll('[data-games-played-item]')
      const item = items?.[items.length - 1] as HTMLElement | undefined
      if (!item) throw new Error('Last Games Played card not found')
      const rect = item.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    }, ROOT_ID)
    await extension.page.mouse.click(lastCenter.x, lastCenter.y)
    await expect(last).toHaveAttribute('aria-pressed', 'true')
  })

  test('keeps the header trail x stable across idle and chip hover readouts', async ({
    extension,
    prepare,
  }) => {
    await prepare({ scenario: 'games-rich', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await waitForGamesPlayed(extension.page)
    // Let shell enter animation settle so trail x is not compared mid-layout.
    await extension.page.waitForTimeout(450)

    const names = await extension.page.evaluate(rootId => {
      const root = document.getElementById(rootId)?.shadowRoot
      return Array.from(root?.querySelectorAll('[data-games-played-item]') ?? []).map(el =>
        (el.getAttribute('aria-label') ?? '').split(' · ')[0] ?? '',
      )
    }, ROOT_ID)
    const shortIdx = names.findIndex(name => name === 'Minecraft')
    const longIdx = names.findIndex(name => name === 'Just Chatting')
    expect(shortIdx).toBeGreaterThanOrEqual(0)
    expect(longIdx).toBeGreaterThanOrEqual(0)

    const idle = await readGamesPlayedState(extension.page)
    await hoverGamesPlayedChip(extension.page, shortIdx)
    const hoverShort = await readGamesPlayedState(extension.page)
    await hoverGamesPlayedChip(extension.page, longIdx)
    const hoverLong = await readGamesPlayedState(extension.page)

    expect(hoverShort.trailText.length).toBeGreaterThan(0)
    expect(Math.abs(hoverShort.trailLeft - idle.trailLeft)).toBeLessThanOrEqual(1)
    expect(Math.abs(hoverLong.trailLeft - idle.trailLeft)).toBeLessThanOrEqual(1)
    expect(hoverShort.firstItemWidth).toBe(idle.firstItemWidth)
    expect(hoverLong.firstItemWidth).toBe(idle.firstItemWidth)
  })

  test('uses immediate reduced-motion arrows and cleans up on panel unmount', async ({
    extension,
    prepare,
  }) => {
    await extension.page.emulateMedia({ reducedMotion: 'reduce' })
    await prepare({ scenario: 'games-rich', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await waitForGamesPlayed(extension.page)
    await setTrackWidth(extension.page, 300)
    await expect.poll(() => readGamesPlayedState(extension.page)).toMatchObject({
      hasRightArrow: true,
    })

    const immediate = await extension.page.evaluate(rootId => {
      const root = document.getElementById(rootId)?.shadowRoot
      const track = root?.querySelector('[data-games-played-track]') as HTMLElement | null
      const button = root?.querySelector('[data-games-played-arrow="next"]') as HTMLButtonElement | null
      if (!track || !button) throw new Error('Games Played next arrow not found')
      track.scrollLeft = 0
      button.click()
      return { scrollLeft: track.scrollLeft, maxScroll: track.scrollWidth - track.clientWidth }
    }, ROOT_ID)
    expect(immediate.scrollLeft).toBeGreaterThan(0)
    expect(immediate.scrollLeft).toBeLessThanOrEqual(immediate.maxScroll)

    await spaNavigateUrlOnly(extension.page, { kind: 'directory' })
    await expect
      .poll(
        () => extension.page.evaluate(rootId => {
          const host = document.getElementById(rootId)
          return !host || !host.shadowRoot?.querySelector('[data-games-played-track]')
        }, ROOT_ID),
        { timeout: 5_000 },
      )
      .toBe(true)
  })
})
