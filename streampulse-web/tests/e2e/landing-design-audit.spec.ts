import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import {
  attachHubRequestTracker,
  auditOutputDir,
  setReducedMotion,
  writeCaptureArtifact,
  type DesignAuditCaptureMeta,
} from './helpers/designAuditCapture'
import {
  attachHostedApiGuard,
  assertHostedApiOnly,
  clearBackendOverrides,
} from './helpers/hostedApi'
import { installHubUxMock, type HubUxMockMode } from './helpers/hubUxMock'

/**
 * Deterministic landing visual audit.
 *
 * First paint must be capturable before /v1/public/hub resolves (static-first).
 * Hub mocks keep data deterministic; empty/error modes expose honesty regressions
 * such as FALLBACK_* ticker numbers.
 */

const AUDIT_VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1280, height: 900 },
  { width: 1440, height: 1000 },
] as const

async function collectLandingDom(page: Page) {
  return page.evaluate(() => {
    const tickers = [...document.querySelectorAll('.sl-ticker')].map((el) => ({
      label: el.querySelector('.sl-ticker__lbl')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      itemCount: el.querySelectorAll('.sl-ticker__item').length,
      sample: el.textContent?.replace(/\s+/g, ' ').trim().slice(0, 240) ?? null,
    }))
    const navLinks = [...document.querySelectorAll('.sl-menu a, .sl-nav__right a')].map((a) => ({
      text: a.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      href: a.getAttribute('href'),
      visible: (a as HTMLElement).offsetParent !== null || getComputedStyle(a).display !== 'none',
    }))
    const skip = document.querySelector('a.sc-skip')
    const mobileToggle = document.querySelector('.sl-mobile-nav__toggle') as HTMLElement | null
    const heroCtas = [...document.querySelectorAll('.sl-hero__actions a')].map((a) => ({
      text: a.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      href: a.getAttribute('href'),
    }))
    const motionSignatures = {
      emoteRain: Boolean(document.querySelector('.sl-fx')),
      chatBackdrop: Boolean(document.querySelector('.sl-chatbg')),
      tickers: document.querySelectorAll('.sl-ticker').length,
      extensionTour: Boolean(document.querySelector('.sl-xtour, #demo')),
      signalGraph: Boolean(document.querySelector('#analysis')),
    }
    return {
      title: document.querySelector('#hero-headline')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      tickers,
      navLinks,
      heroCtas,
      hasSkipLink: Boolean(skip),
      skipHref: skip?.getAttribute('href') ?? null,
      mobileNavToggleVisible: Boolean(
        mobileToggle && getComputedStyle(mobileToggle).display !== 'none' && mobileToggle.offsetParent !== null,
      ),
      motionSignatures,
      menuDisplay: getComputedStyle(document.querySelector('.sl-menu') ?? document.body).display,
      navRightDisplay: getComputedStyle(document.querySelector('.sl-nav__right') ?? document.body).display,
    }
  })
}

test.describe('landing design audit (deterministic capture)', () => {
  test.beforeEach(async ({ page }) => {
    await clearBackendOverrides(page)
  })

  test('landing first-paint → hub ready sequence', async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    const violations = attachHostedApiGuard(page)
    await installHubUxMock(page, { hubDelayMs: 1_200 })
    const outDir = auditOutputDir(testInfo, 'landing-sequence')
    const hubHits = attachHubRequestTracker(page)

    const hubWait = page.waitForResponse(
      (response) => {
        try {
          return new URL(response.url()).pathname === '/v1/public/hub'
        } catch {
          return false
        }
      },
      { timeout: 60_000 },
    )

    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const firstPaintMeta = await writeCaptureArtifact(page, outDir, '01-immediate-first-paint', {
      phase: 'loading',
      fixture: 'landing-hub-delayed',
      interaction: 'fold',
      firstPaintHubRequests: [...hubHits],
    })
    const firstDom = await collectLandingDom(page)

    const hubResponse = await hubWait
    await writeCaptureArtifact(page, outDir, '02-after-hub-response', {
      phase: 'loading',
      fixture: 'landing-hub-ready',
      interaction: 'fold',
    })

    // Tickers hydrate after hub — wait on DOM, never sleep.
    await expect(page.locator('.sl-hero')).toBeVisible()
    await page.waitForFunction(() => {
      const items = document.querySelectorAll('.sl-ticker__item')
      return items.length > 0 || document.querySelectorAll('.sl-ticker').length === 0
    }, null, { timeout: 30_000 }).catch(() => undefined)

    const readyMeta = await writeCaptureArtifact(page, outDir, '03-after-ui-ready', {
      phase: 'ready',
      fixture: 'landing-hub-ready',
      interaction: 'fold',
    })
    const readyDom = await collectLandingDom(page)

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.waitForFunction(() => window.scrollY > 8, null, { timeout: 10_000 }).catch(() => undefined)
    await page.evaluate(() => window.scrollTo(0, 0))
    await writeCaptureArtifact(page, outDir, '04-after-scroll-return', {
      phase: 'ready',
      fixture: 'landing-hub-ready',
      interaction: 'fold',
    })
    await writeCaptureArtifact(page, outDir, 'landing-1440-full', {
      phase: 'ready',
      fixture: 'landing-hub-ready',
      interaction: 'full',
      fullPage: true,
    })

    // Mobile: menu/CTA discoverability
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.sl-hero')).toBeVisible()
    const mobileDom = await collectLandingDom(page)
    await writeCaptureArtifact(page, outDir, 'landing-390-fold', {
      phase: 'ready',
      fixture: 'landing-hub-ready',
      interaction: 'fold',
      extra: { mobileDom },
    })

    const evidence = {
      firstPaint: { meta: firstPaintMeta, dom: firstDom, hubHitsAtFirstPaint: [...hubHits] },
      afterReady: { meta: readyMeta, dom: readyDom, hubStatus: hubResponse.status() },
      mobile: mobileDom,
    }
    fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2))

    const honesty = {
      fallbackTickerLikely:
        JSON.stringify(readyDom.tickers).includes('widespeedlaugh') ||
        JSON.stringify(readyDom.tickers).includes('22.1K') ||
        JSON.stringify(readyDom.tickers).includes('caseoh_'),
      hasSkipLink: readyDom.hasSkipLink,
      skipHref: readyDom.skipHref,
      mobileMenuDisplay: mobileDom.menuDisplay,
      mobileNavRightDisplay: mobileDom.navRightDisplay,
      mobileNavToggleVisible: mobileDom.mobileNavToggleVisible,
      heroCtas: readyDom.heroCtas,
      motionSignatures: readyDom.motionSignatures,
      hubOnCriticalPathNote:
        'Landing polls /v1/public/hub; first-paint may already have outstanding hub requests.',
      hubHitsSample: hubHits.slice(0, 8),
    }
    fs.writeFileSync(path.join(outDir, 'honesty-probes.json'), JSON.stringify(honesty, null, 2))

    expect(firstPaintMeta.git.headShort).toBeTruthy()
    expect(page.url()).toMatch(/\/$|\/\?/)
    expect(readyDom.hasSkipLink, 'landing must expose a.sc-skip').toBe(true)
    expect(readyDom.skipHref, 'skip link must target main, not a mid-page demo').toBe('#main')
    expect(mobileDom.mobileNavToggleVisible, '390px must expose landing mobile nav').toBe(true)
    assertHostedApiOnly(violations)
    await testInfo.attach('landing-evidence', {
      path: path.join(outDir, 'evidence.json'),
      contentType: 'application/json',
    })
  })

  for (const mode of ['empty', 'error'] as HubUxMockMode[]) {
    test(`landing phase matrix: ${mode}`, async ({ page }, testInfo) => {
      test.setTimeout(120_000)
      const violations = attachHostedApiGuard(page)
      await installHubUxMock(page, { mode })
      const outDir = auditOutputDir(testInfo, `landing-phase-${mode}`)
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.goto('/', { waitUntil: 'domcontentloaded' })
      await expect(page.locator('.sl-hero')).toBeVisible()
      // Allow ticker builders to settle on empty/error payloads
      await page.waitForLoadState('networkidle').catch(() => undefined)
      const dom = await collectLandingDom(page)
      await writeCaptureArtifact(page, outDir, `landing-${mode}-1440`, {
        phase: mode === 'error' ? 'error' : 'empty',
        fixture: `landing-hub-${mode}`,
        interaction: 'fold',
        extra: { dom },
      })
      const probes = {
        mode,
        tickerSamples: dom.tickers,
        /** S0 probe: fallback numbers must not appear when hub is empty/error. */
        containsFallbackEmote: JSON.stringify(dom.tickers).includes('widespeedlaugh'),
        containsFallbackMover: JSON.stringify(dom.tickers).includes('caseoh_'),
        containsFallbackCount: JSON.stringify(dom.tickers).includes('22.1K'),
      }
      fs.writeFileSync(path.join(outDir, 'honesty-probes.json'), JSON.stringify(probes, null, 2))
      expect(probes.containsFallbackEmote, 'empty/error must not invent FALLBACK emotes').toBe(false)
      expect(probes.containsFallbackMover, 'empty/error must not invent FALLBACK movers').toBe(false)
      expect(probes.containsFallbackCount, 'empty/error must not invent FALLBACK counts').toBe(false)
      assertHostedApiOnly(violations)
    })
  }

  test('landing viewport + reduced-motion matrix (sample)', async ({ page }, testInfo) => {
    test.setTimeout(240_000)
    const violations = attachHostedApiGuard(page)
    await installHubUxMock(page)
    const outDir = auditOutputDir(testInfo, 'landing-viewport-matrix')
    const summary: DesignAuditCaptureMeta[] = []

    for (const vp of AUDIT_VIEWPORTS) {
      await page.setViewportSize(vp)
      await setReducedMotion(page, false)
      await page.goto('/', { waitUntil: 'domcontentloaded' })
      await expect(page.locator('.sl-hero')).toBeVisible()
      summary.push(
        await writeCaptureArtifact(page, outDir, `landing-${vp.width}-ready`, {
          phase: 'ready',
          fixture: 'landing-hub-ready',
          interaction: 'fold',
          extra: { dom: await collectLandingDom(page) },
        }),
      )
    }

    await page.setViewportSize({ width: 1280, height: 900 })
    await setReducedMotion(page, true)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.sl-hero')).toBeVisible()
    summary.push(
      await writeCaptureArtifact(page, outDir, 'landing-1280-reduced-motion', {
        phase: 'ready',
        fixture: 'landing-hub-ready',
        interaction: 'fold',
      }),
    )

    await page.evaluate(() => {
      document.documentElement.style.zoom = '2'
    })
    summary.push(
      await writeCaptureArtifact(page, outDir, 'landing-1280-zoom-200', {
        phase: 'ready',
        fixture: 'landing-hub-ready',
        interaction: 'fold',
        extra: { zoom: '200%' },
      }),
    )
    await page.evaluate(() => {
      document.documentElement.style.zoom = ''
    })

    fs.writeFileSync(path.join(outDir, 'matrix-summary.json'), JSON.stringify(summary, null, 2))
    expect(summary.length).toBeGreaterThanOrEqual(AUDIT_VIEWPORTS.length)
    assertHostedApiOnly(violations)
  })
})
