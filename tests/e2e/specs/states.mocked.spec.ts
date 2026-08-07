import { test, expect } from '../helpers/testFixtures.ts'
import {
  assertExactlyOnePulseRoot,
  assertGameDividersSpanPlot,
  assertNoPulseVodDiscoverWarnings,
  assertNoUncaughtErrors,
  assertPulseShadowContains,
  waitForPulseRoot,
} from '../helpers/assertions.ts'
import { openTwitchChannel, openTwitchVod } from '../helpers/mockTwitch.ts'
import { readExtensionStorage } from '../helpers/extensionContext.ts'

async function assertPanelScrollBarHidden(page: import('@playwright/test').Page): Promise<void> {
  const metrics = await page.evaluate(rootId => {
    const root = document.getElementById(rootId)?.shadowRoot
    const scroll = root?.querySelector('[data-testid="pulse-panel-scroll"]') as HTMLElement | null
    if (!scroll) return null
    const style = getComputedStyle(scroll)
    return {
      scrollbarWidth: style.scrollbarWidth,
      gutter: scroll.offsetWidth - scroll.clientWidth,
      overflowY: style.overflowY,
      hasNoScrollbarClass: scroll.classList.contains('pulse-no-scrollbar'),
    }
  }, 'streamclone-pulse-root')

  expect(metrics, 'expected pulse panel scroll region').not.toBeNull()
  expect(metrics!.hasNoScrollbarClass).toBe(true)
  expect(metrics!.scrollbarWidth).toBe('none')
  expect(metrics!.gutter).toBeLessThanOrEqual(1)
  expect(['auto', 'scroll', 'overlay']).toContain(metrics!.overflowY)
}

test.describe('extension mocked states', () => {
  test('live ready shows Pulse overlay with tracked live content', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertExactlyOnePulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /Pulse|Chat tracked|Just Chatting|fixturechan/i)
    await assertPanelScrollBarHidden(extension.page)
    assertNoUncaughtErrors(evidence)
    assertNoPulseVodDiscoverWarnings(evidence)
  })

  test('live ready game dividers span viewers through emote lane', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /League of Legends|Just Chatting/i)
    await assertGameDividersSpanPlot(extension.page)
    assertNoUncaughtErrors(evidence)
  })

  test('live ready chart range change stays free of storage/SVG console noise', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: {
        defaultChartWindow: 'full',
        defaultChartWindowMigratedToFullV1: true,
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /Range|Full|30|Games played|Pulse/i)

    // Playwright pointer clicks exercise hit-testing across the shadow portal.
    const trigger = extension.page.getByRole('button', { name: 'Chart time range' })
    await trigger.click()
    await extension.page.getByRole('option', { name: '30 min', exact: true }).click()
    await expect(trigger).toContainText('30 min')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')

    const legendLabels = await extension.page.evaluate(rootId => {
      const legend = document
        .getElementById(rootId)
        ?.shadowRoot
        ?.querySelector('[aria-label="Chart series legend"]')
      return [...(legend?.children ?? [])].map(item => (item.textContent ?? '').trim())
    }, 'streamclone-pulse-root')
    expect(legendLabels).toEqual(['Viewers', 'Chat trend', 'Emote trend'])

    const activityBarCounts = await extension.page.evaluate(rootId => {
      const root = document.getElementById(rootId)?.shadowRoot
      return {
        chat: root?.querySelectorAll('[data-chart-series="chat-bars"] rect').length ?? 0,
        emotes: root?.querySelectorAll('[data-chart-series="emote-bars"] rect').length ?? 0,
      }
    }, 'streamclone-pulse-root')
    expect(activityBarCounts.chat).toBeGreaterThan(0)
    expect(activityBarCounts.emotes).toBeGreaterThan(0)

    // Give hydration + resize a beat, then assert no storage/context/SVG noise.
    await extension.page.waitForTimeout(750)
    assertNoUncaughtErrors(evidence)
  })

  test('open selects stay pinned to their trigger while the panel scrolls', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    async function assertSelectPinnedOrClosed(ariaLabel: string): Promise<void> {
      const trigger = extension.page.getByRole('button', { name: ariaLabel })
      await expect(trigger).toBeVisible()
      await trigger.evaluate(el => {
        el.scrollIntoView({ block: 'center', inline: 'nearest' })
      })
      await trigger.click()
      await expect(trigger).toHaveAttribute('aria-expanded', 'true')

      const before = await extension.page.evaluate(
        ({ rootId, label }) => {
          const root = document.getElementById(rootId)?.shadowRoot
          const btn = root?.querySelector(
            `button[aria-label="${label}"]`,
          ) as HTMLButtonElement | null
          const menu = root?.querySelector(
            `ul[role="listbox"][aria-label="${label}"]`,
          ) as HTMLElement | null
          const scroll = root?.querySelector('.pulse-panel-scroll') as HTMLElement | null
          if (!btn || !menu || !scroll) return null
          return {
            scrollHeight: scroll.scrollHeight,
            clientHeight: scroll.clientHeight,
            scrollTop: scroll.scrollTop,
          }
        },
        { rootId: 'streamclone-pulse-root', label: ariaLabel },
      )
      expect(before, `${ariaLabel} menu should open`).not.toBeNull()

      const maxDelta = before!.scrollHeight - before!.clientHeight - before!.scrollTop
      const scrollDelta = Math.min(120, Math.max(40, maxDelta > 0 ? Math.min(120, maxDelta) : 0))
      if (scrollDelta > 0) {
        await extension.page.evaluate(
          ({ rootId, delta }) => {
            const scroll = document
              .getElementById(rootId)
              ?.shadowRoot
              ?.querySelector('.pulse-panel-scroll') as HTMLElement | null
            if (scroll) scroll.scrollTop += delta
          },
          { rootId: 'streamclone-pulse-root', delta: scrollDelta },
        )
      }

      await expect
        .poll(
          async () => {
            return extension.page.evaluate(
              ({ rootId, label, allowClosed }) => {
                const root = document.getElementById(rootId)?.shadowRoot
                const btn = root?.querySelector(
                  `button[aria-label="${label}"]`,
                ) as HTMLButtonElement | null
                const menu = root?.querySelector(
                  `ul[role="listbox"][aria-label="${label}"]`,
                ) as HTMLElement | null
                if (!btn) return false
                const expanded = btn.getAttribute('aria-expanded') === 'true'
                if (!expanded || !menu) return allowClosed
                const triggerRect = btn.getBoundingClientRect()
                const menuRect = menu.getBoundingClientRect()
                const menuEdgeGap = Math.min(
                  Math.abs(menuRect.top - triggerRect.bottom),
                  Math.abs(triggerRect.top - menuRect.bottom),
                )
                return menuEdgeGap <= 8
              },
              {
                rootId: 'streamclone-pulse-root',
                label: ariaLabel,
                allowClosed: scrollDelta > 0,
              },
            )
          },
          { timeout: 3_000 },
        )
        .toBe(true)

      const stillOpen = await extension.page.evaluate(
        ({ rootId, label }) => {
          const btn = document
            .getElementById(rootId)
            ?.shadowRoot
            ?.querySelector(`button[aria-label="${label}"]`)
          return btn?.getAttribute('aria-expanded') === 'true'
        },
        { rootId: 'streamclone-pulse-root', label: ariaLabel },
      )
      if (stillOpen) {
        await extension.page.keyboard.press('Escape')
      }
    }

    await assertSelectPinnedOrClosed('Chart time range')

    const sortVisible = await extension.page
      .getByRole('button', { name: 'Sort most reacted moments' })
      .isVisible()
      .catch(() => false)
    if (sortVisible) {
      await assertSelectPinnedOrClosed('Sort most reacted moments')
    }

    assertNoUncaughtErrors(evidence)
  })

  test('chart expand and reset keep rendered height aligned with SVG geometry', async ({
    extension,
    prepare,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: {
        overlayMode: 'expanded',
        overlayPlacement: 'sidebar',
        sidebarTab: 'pulse',
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await extension.page.waitForTimeout(700)

    const chart = extension.page.getByTestId('pulse-overview-chart')
    const sampleTransition = async () => chart.evaluate(async node => {
        const chart = node as SVGSVGElement
        const samples: Array<{ rendered: number; geometry: number }> = []
        for (let frame = 0; frame < 18; frame += 1) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
          samples.push({
            rendered: chart.getBoundingClientRect().height,
            geometry: chart.viewBox.baseVal.height,
          })
        }
        return samples
      })

    await extension.page.getByRole('button', { name: 'Expand', exact: true }).click()
    const expanded = await sampleTransition()
    const expandedGeometry = await chart.evaluate(node => {
      const chart = node as SVGSVGElement
      const chartRect = chart.getBoundingClientRect()
      const axisLabels = [...chart.querySelectorAll('text')].filter(label =>
        /^(?:\d{1,2}:\d{2}(?::\d{2})?|Now)$/i.test((label.textContent ?? '').trim()),
      )
      const expandedAxisFits = axisLabels.length > 0 && axisLabels.every(label => {
        const rect = label.getBoundingClientRect()
        return rect.top >= chartRect.top && rect.bottom <= chartRect.bottom + 0.5
      })
      const frameRect = chart.parentElement?.parentElement?.getBoundingClientRect()
      const expandedAxisVisible = Boolean(frameRect) && axisLabels.every(label =>
        label.getBoundingClientRect().bottom <= frameRect!.bottom + 0.5,
      )
      return { expandedAxisFits, expandedAxisVisible }
    })
    await extension.page.getByRole('button', { name: 'Reset', exact: true }).click()
    const collapsed = await sampleTransition()
    const result = { expanded, collapsed, ...expandedGeometry }

    expect(result, 'expected chart and Expand/Reset controls').not.toBeNull()
    const samples = [...(result?.expanded ?? []), ...(result?.collapsed ?? [])]
    const maxMismatch = Math.max(
      ...samples.map(sample => Math.abs(sample.rendered - sample.geometry)),
    )
    expect(maxMismatch).toBeLessThanOrEqual(1.5)
    expect(result?.expandedAxisFits).toBe(true)
    expect(result?.expandedAxisVisible).toBe(true)
  })

  test('footer settings gear opens settings and Back keeps placement', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: { overlayMode: 'expanded', overlayPlacement: 'sidebar', sidebarTab: 'pulse' },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const footer = extension.page.getByTestId('pulse-panel-footer')
    const gear = footer.getByRole('button', { name: 'Open settings', exact: true })
    await expect(gear).toBeVisible()
    await expect(footer.getByRole('button', { name: /Open Analytics Hub/i })).toHaveCount(0)
    await gear.click()
    await expect(extension.page.getByRole('button', { name: 'Back to Pulse', exact: true }).first()).toBeVisible()
    await extension.page.locator('.pulse-settings-back').click()
    await expect(extension.page.getByText('Stream Pulse', { exact: true })).toBeVisible()
    await expect(footer.getByRole('button', { name: 'Open settings', exact: true })).toBeVisible()
    await expect.poll(async () => readExtensionStorage(extension.serviceWorker, [
      'overlayMode',
      'overlayPlacement',
    ])).toMatchObject({ overlayMode: 'expanded', overlayPlacement: 'sidebar' })
    assertNoUncaughtErrors(evidence)
  })

  test('settings gear stays in the panel footer bottom-right', async ({
    extension,
    prepare,
    evidence,
  }, testInfo) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: {
        overlayMode: 'expanded',
        overlayPlacement: 'sidebar',
        sidebarTab: 'pulse',
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await expect(extension.page.getByText('Stream Pulse', { exact: true })).toBeVisible()

    const footer = extension.page.getByTestId('pulse-panel-footer')
    const gear = footer.getByRole('button', { name: 'Open settings', exact: true })
    await expect(gear).toBeVisible()

    const layout = await extension.page.evaluate(rootId => {
      const root = document.getElementById(rootId)?.shadowRoot
      const gearBtn = root?.querySelector('button[aria-label="Open settings"]') as HTMLElement | null
      const footerEl = root?.querySelector('[data-testid="pulse-panel-footer"]') as HTMLElement | null
      const header = root?.querySelector('[data-testid="stream-pulse-header"]') as HTMLElement | null
      const body = root?.querySelector('.pulse-panel-body') as HTMLElement | null
      const hubInFooter = Boolean(footerEl?.querySelector('[data-testid="analytics-hub-cta-wrap"]'))
      if (!gearBtn || !footerEl || !body) return null
      if (body) body.scrollTop = 0
      const gearRect = gearBtn.getBoundingClientRect()
      const footerRect = footerEl.getBoundingClientRect()
      const headerRect = header?.getBoundingClientRect()
      const bodyRect = body.getBoundingClientRect()
      const style = getComputedStyle(gearBtn)
      return {
        gearInFooter:
          gearRect.top >= footerRect.top - 1
          && gearRect.bottom <= footerRect.bottom + 1
          && gearRect.left >= footerRect.left - 1
          && gearRect.right <= footerRect.right + 1,
        gearNearFooterRight: Math.abs(gearRect.right - footerRect.right) <= 8,
        gearBelowHeader: headerRect ? gearRect.top >= headerRect.bottom - 1 : true,
        gearInBodyViewport: gearRect.top >= bodyRect.top - 1 && gearRect.bottom <= bodyRect.bottom + 1,
        hubInFooter,
        pointerEvents: style.pointerEvents,
        visibility: style.visibility,
        opacity: style.opacity,
      }
    }, 'streamclone-pulse-root')

    expect(layout, 'expected settings gear in panel footer').not.toBeNull()
    expect(layout?.gearInFooter).toBe(true)
    expect(layout?.gearNearFooterRight).toBe(true)
    expect(layout?.gearBelowHeader).toBe(true)
    expect(layout?.gearInBodyViewport).toBe(true)
    expect(layout?.hubInFooter).toBe(false)
    expect(layout?.pointerEvents).not.toBe('none')
    expect(layout?.visibility).not.toBe('hidden')
    expect(Number(layout?.opacity ?? 0)).toBeGreaterThan(0.5)

    await gear.click()
    await expect(footer.getByRole('button', { name: 'Back to Pulse', exact: true })).toBeVisible()
    await footer.getByRole('button', { name: 'Back to Pulse', exact: true }).click()
    await expect(extension.page.getByText('Stream Pulse', { exact: true })).toBeVisible()
    await expect(footer.getByRole('button', { name: 'Open settings', exact: true })).toBeVisible()
    await expect.poll(async () => readExtensionStorage(extension.serviceWorker, [
      'overlayMode',
      'overlayPlacement',
    ])).toMatchObject({ overlayMode: 'expanded', overlayPlacement: 'sidebar' })

    await footer.screenshot({
      path: testInfo.outputPath('sidebar-footer-settings-gear.png'),
    })
    assertNoUncaughtErrors(evidence)
  })

  test('Analytics Hub CTA is full width under the pulse header, not footer', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: {
        overlayMode: 'expanded',
        overlayPlacement: 'sidebar',
        sidebarTab: 'pulse',
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const metrics = await extension.page.evaluate(rootId => {
      const root = document.getElementById(rootId)?.shadowRoot
      const header = root?.querySelector('[data-testid="stream-pulse-header"]') as HTMLElement | null
      const footer = root?.querySelector('[data-testid="pulse-panel-footer"]') as HTMLElement | null
      const wrap = root?.querySelector('[data-testid="analytics-hub-cta-wrap"]') as HTMLElement | null
      const btn = wrap?.querySelector('.pulse-analytics-hub-cta') as HTMLElement | null
      if (!header || !footer || !wrap || !btn) return null
      const headerRect = header.getBoundingClientRect()
      const footerRect = footer.getBoundingClientRect()
      const wrapRect = wrap.getBoundingClientRect()
      const btnRect = btn.getBoundingClientRect()
      return {
        hubInHeader:
          wrapRect.top >= headerRect.top - 1
          && wrapRect.bottom <= headerRect.bottom + 1,
        hubAboveFooter: wrapRect.bottom <= footerRect.top + 1,
        footerHasHub: Boolean(footer.querySelector('[data-testid="analytics-hub-cta-wrap"]')),
        widthDelta: Math.abs(btnRect.width - wrapRect.width),
        btnWidth: btnRect.width,
      }
    }, 'streamclone-pulse-root')

    expect(metrics, 'CTA metrics').not.toBeNull()
    expect(metrics!.hubInHeader).toBe(true)
    expect(metrics!.hubAboveFooter).toBe(true)
    expect(metrics!.footerHasHub).toBe(false)
    expect(metrics!.btnWidth).toBeGreaterThan(100)
    expect(metrics!.widthDelta).toBeLessThanOrEqual(2)
    assertNoUncaughtErrors(evidence)
  })

  test('settings view has no hub in footer and shell uses a single scroll region', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: {
        overlayMode: 'expanded',
        overlayPlacement: 'sidebar',
        sidebarTab: 'pulse',
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const footer = extension.page.getByTestId('pulse-panel-footer')
    await footer.getByRole('button', { name: 'Open settings', exact: true }).click()
    await expect(extension.page.locator('.pulse-settings-back')).toBeVisible()

    await extension.page.getByRole('button', { name: 'Volt', exact: true }).click()
    await extension.page.getByRole('button', { name: 'Bottom dock', exact: true }).click()

    const chrome = await extension.page.evaluate(rootId => {
      const root = document.getElementById(rootId)?.shadowRoot
      const shell = root?.querySelector('.pulse-shell') as HTMLElement | null
      const footerEl = root?.querySelector('[data-testid="pulse-panel-footer"]') as HTMLElement | null
      const scroll = root?.querySelector('.pulse-panel-scroll') as HTMLElement | null
      if (!shell || !footerEl || !scroll) return null
      const shellStyle = getComputedStyle(shell)
      return {
        shellOverflow: shellStyle.overflow,
        shellOverflowY: shellStyle.overflowY,
        footerHasHub: Boolean(footerEl.querySelector('[data-testid="analytics-hub-cta-wrap"]')),
        shellClass: shell.className,
      }
    }, 'streamclone-pulse-root')

    expect(chrome).not.toBeNull()
    expect(chrome!.shellOverflow === 'hidden' || chrome!.shellOverflowY === 'hidden').toBe(true)
    expect(chrome!.footerHasHub).toBe(false)
    expect(chrome!.shellClass).toContain('placement-sidebar')
    await assertPanelScrollBarHidden(extension.page)

    await expect.poll(async () => readExtensionStorage(extension.serviceWorker, [
      'overlayPlacement',
    ])).toMatchObject({ overlayPlacement: 'bottom' })

    // Chat still open: stays sidebar-snapped, not a floating mini dock.
    await expect(extension.page.getByText('Stream Pulse', { exact: true })).toHaveCount(0)
    await expect(extension.page.locator('.pulse-settings-back')).toBeVisible()
    assertNoUncaughtErrors(evidence)
  })

  test('chat open with bottom placement keeps sidebar snap, not floating dock', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: {
        overlayMode: 'expanded',
        overlayPlacement: 'bottom',
        sidebarTab: 'pulse',
        chatClosedPulseDockEnabled: false,
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const state = await extension.page.evaluate(rootId => {
      const host = document.getElementById(rootId)
      const root = host?.shadowRoot
      const shell = root?.querySelector('.pulse-shell') as HTMLElement | null
      return {
        hostDisplay: host ? getComputedStyle(host).display : null,
        shellClass: shell?.className ?? '',
      }
    }, 'streamclone-pulse-root')

    expect(state.hostDisplay).not.toBe('none')
    expect(state.shellClass).toContain('placement-sidebar')
    expect(state.shellClass).not.toContain('placement-bottom')
    await expect(extension.page.getByText('Stream Pulse', { exact: true })).toBeVisible()
    assertNoUncaughtErrors(evidence)
  })

  test('chat closed with dock off hides Pulse host', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: {
        overlayMode: 'expanded',
        overlayPlacement: 'bottom',
        chatClosedPulseDockEnabled: false,
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    await extension.page.evaluate(() => {
      const col = document.querySelector('.channel-root__right-column') as HTMLElement | null
      if (col) col.style.display = 'none'
    })

    await expect.poll(async () => extension.page.evaluate(rootId => {
      const host = document.getElementById(rootId)
      return host ? getComputedStyle(host).display : null
    }, 'streamclone-pulse-root')).toBe('none')

    assertNoUncaughtErrors(evidence)
  })

  test('chat closed with dock on and bottom placement floats bottom chrome', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: {
        overlayMode: 'expanded',
        overlayPlacement: 'bottom',
        chatClosedPulseDockEnabled: true,
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    await extension.page.evaluate(() => {
      const col = document.querySelector('.channel-root__right-column') as HTMLElement | null
      if (col) col.style.display = 'none'
    })

    await expect.poll(async () => extension.page.evaluate(rootId => {
      const host = document.getElementById(rootId)
      const root = host?.shadowRoot
      const shell = root?.querySelector('.pulse-shell') as HTMLElement | null
      const header = root?.querySelector('[data-testid="stream-pulse-header"]') as HTMLElement | null
      const footer = root?.querySelector('[data-testid="pulse-panel-footer"]') as HTMLElement | null
      const wrap = root?.querySelector('[data-testid="analytics-hub-cta-wrap"]') as HTMLElement | null
      if (!host || !shell || !header || !footer || !wrap) return null
      const hostStyle = getComputedStyle(host)
      const shellStyle = getComputedStyle(shell)
      const headerRect = header.getBoundingClientRect()
      const wrapRect = wrap.getBoundingClientRect()
      return {
        hostDisplay: hostStyle.display,
        shellClass: shell.className,
        shellOverflow: shellStyle.overflow,
        hubInHeader: wrapRect.top >= headerRect.top - 1 && wrapRect.bottom <= headerRect.bottom + 1,
        footerHasHub: Boolean(footer.querySelector('[data-testid="analytics-hub-cta-wrap"]')),
      }
    }, 'streamclone-pulse-root')).toMatchObject({
      hostDisplay: 'block',
      shellClass: expect.stringContaining('placement-bottom'),
      shellOverflow: 'hidden',
      hubInHeader: true,
      footerHasHub: false,
    })

    await expect(extension.page.getByText('Stream Pulse', { exact: true })).toBeVisible()
    await expect(extension.page.getByTestId('pulse-panel-footer').getByRole('button', { name: 'Open settings', exact: true })).toBeVisible()
    assertNoUncaughtErrors(evidence)
  })

  test('chat closed with dock on and right placement floats right chrome', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: {
        overlayMode: 'expanded',
        overlayPlacement: 'right',
        chatClosedPulseDockEnabled: true,
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    await extension.page.evaluate(() => {
      const col = document.querySelector('.channel-root__right-column') as HTMLElement | null
      if (col) col.style.display = 'none'
    })

    await expect.poll(async () => extension.page.evaluate(rootId => {
      const host = document.getElementById(rootId)
      const shell = host?.shadowRoot?.querySelector('.pulse-shell') as HTMLElement | null
      if (!host || !shell) return null
      return {
        hostDisplay: getComputedStyle(host).display,
        shellClass: shell.className,
      }
    }, 'streamclone-pulse-root')).toMatchObject({
      hostDisplay: 'block',
      shellClass: expect.stringContaining('placement-right'),
    })

    assertNoUncaughtErrors(evidence)
  })

  test('legacy hidden placement migrates to expanded sidebar', async ({
    extension,
    prepare,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: { overlayMode: 'expanded', overlayPlacement: 'hidden' },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    await expect(extension.page.getByText('Stream Pulse', { exact: true })).toBeVisible()
    await expect.poll(async () => readExtensionStorage(extension.serviceWorker, [
      'overlayMode',
      'overlayPlacement',
    ])).toMatchObject({ overlayMode: 'expanded', overlayPlacement: 'sidebar' })
  })

  test('live partial / starting surfaces not-tracked / starting copy', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-partial', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    // Hosted + warming tier shows the not-tracked live path (starting / not yet IRC-active).
    await assertPulseShadowContains(extension.page, /Not tracked|IRC pool|Partial|Warming|tracking/i)
    assertNoUncaughtErrors(evidence)
  })

  test('Helix unavailable is visible without crashing the overlay', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'helix-off', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /Helix|Pulse|fixturechan/i)
    assertNoUncaughtErrors(evidence)
  })

  test('offline channel renders offline / recap path', async ({ extension, prepare, evidence }) => {
    await prepare({ scenario: 'offline', twitchKind: 'offline' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /offline|Recap|Past|fixturechan/i)
    await assertPanelScrollBarHidden(extension.page)
    assertNoUncaughtErrors(evidence)
  })

  test('VOD ready mounts Replay Pulse', async ({ extension, prepare, evidence }) => {
    await prepare({ scenario: 'vod-ready', twitchKind: 'vod' })
    await openTwitchVod(extension.page)
    await waitForPulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /Replay|VOD|ready|Pulse|Chat spike/i)
    await assertPanelScrollBarHidden(extension.page)
    assertNoUncaughtErrors(evidence)
  })

  test('VOD syncing shows syncing status', async ({ extension, prepare, evidence }) => {
    await prepare({ scenario: 'vod-syncing', twitchKind: 'vod' })
    await openTwitchVod(extension.page)
    await waitForPulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /sync|Syncing|Replay|Pulse/i)
    assertNoUncaughtErrors(evidence)
  })

  test('API 500 shows a recoverable error, then clears on live-ready', async ({
    extension,
    prepare,
    api,
    evidence,
  }) => {
    await prepare({ scenario: 'api-500', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertExactlyOnePulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /Can.?t reach|No response|Retry|Streamclone/i)

    api.setScenario('live-ready')
    await extension.page.evaluate(rootId => {
      const host = document.getElementById(rootId)
      const root = host?.shadowRoot
      const retry = [...(root?.querySelectorAll('button') ?? [])].find(button =>
        /retry/i.test(button.textContent ?? ''),
      )
      retry?.click()
    }, 'streamclone-pulse-root')

    await expect
      .poll(async () => {
        const text = await extension.page.evaluate(rootId => {
          const host = document.getElementById(rootId)
          return host?.shadowRoot?.textContent ?? ''
        }, 'streamclone-pulse-root')
        return /Can.?t reach|No response from/i.test(text)
      }, { timeout: 8_000 })
      .toBe(false)

    await assertPulseShadowContains(extension.page, /Pulse|Chat tracked|fixturechan/i)
    expect(evidence.pageErrors).toEqual([])
  })

  test('API 500 does not leave uncaught page exceptions', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'api-500', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await assertExactlyOnePulseRoot(extension.page)
    // Overlay may show error/empty state; page must stay stable.
    expect(evidence.pageErrors).toEqual([])
  })

  test('API timeout does not leave uncaught page exceptions', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'timeout', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    expect(evidence.pageErrors).toEqual([])
  })

  test('malformed JSON response does not leave uncaught page exceptions', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'malformed', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    expect(evidence.pageErrors).toEqual([])
  })
})
