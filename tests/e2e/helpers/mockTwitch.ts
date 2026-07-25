import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserContext, Page, Route } from '@playwright/test'

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/twitch')

export type TwitchFixtureKind = 'live' | 'offline' | 'vod'

const FILE_BY_KIND: Record<TwitchFixtureKind, string> = {
  live: 'channel-live.html',
  offline: 'channel-offline.html',
  vod: 'vod.html',
}

function readFixture(kind: TwitchFixtureKind): string {
  return fs.readFileSync(path.join(fixturesDir, FILE_BY_KIND[kind]), 'utf8')
}

function titleFor(kind: TwitchFixtureKind, login: string, vodId?: string): string {
  if (kind === 'vod') return `VOD ${vodId ?? ''} - Twitch`
  return `${login} - Twitch`
}

export interface MockTwitchOptions {
  login?: string
  vodId?: string
  kind?: TwitchFixtureKind
}

/**
 * Intercept Twitch document navigations and fulfill with local HTML fixtures.
 * Content scripts still inject because the browser URL stays on *.twitch.tv.
 */
export async function installTwitchFixtures(
  context: BrowserContext,
  options: MockTwitchOptions = {},
): Promise<{ setKind: (kind: TwitchFixtureKind) => void }> {
  let kind: TwitchFixtureKind = options.kind ?? 'live'
  const login = options.login ?? 'fixturechan'
  const vodId = options.vodId ?? '2806037629'

  const fulfill = async (route: Route) => {
    const url = new URL(route.request().url())
    if (route.request().resourceType() !== 'document') {
      await route.fulfill({
        status: 204,
        body: '',
      })
      return
    }

    const html = readFixture(kind)
      .replaceAll('fixturechan', login)
      .replace(/<title>.*?<\/title>/, `<title>${titleFor(kind, login, vodId)}</title>`)

    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: html,
    })
    void url
  }

  await context.route('https://www.twitch.tv/**', fulfill)
  await context.route('https://twitch.tv/**', fulfill)
  // Block noisy third-party assets from live Twitch CDN while keeping URL shape.
  await context.route('https://static.twitchcdn.net/**', route => route.abort())
  await context.route('https://assets.twitch.tv/**', route => route.abort())

  return {
    setKind(next) {
      kind = next
    },
  }
}

export async function stubTwitchMedia(page: Page, kind: TwitchFixtureKind): Promise<void> {
  await page.evaluate(mode => {
    const video = document.querySelector('video') as HTMLVideoElement | null
    if (!video) return
    const duration = mode === 'live' ? Infinity : 3600
    Object.defineProperty(video, 'duration', { configurable: true, get: () => duration })
    try {
      video.currentTime = mode === 'live' ? 1 : 120
    } catch {
      /* ignore */
    }
  }, kind)
}

export async function openTwitchChannel(
  page: Page,
  login = 'fixturechan',
  waitUntil: 'domcontentloaded' | 'load' = 'domcontentloaded',
): Promise<void> {
  await page.goto(`https://www.twitch.tv/${login}`, { waitUntil, timeout: 30_000 })
  await stubTwitchMedia(page, 'live')
}

export async function openTwitchVod(
  page: Page,
  vodId = '2806037629',
  waitUntil: 'domcontentloaded' | 'load' = 'domcontentloaded',
): Promise<void> {
  await page.goto(`https://www.twitch.tv/videos/${vodId}`, { waitUntil, timeout: 30_000 })
  await stubTwitchMedia(page, 'vod')
}

/**
 * SPA navigation without full document reload (pushState + DOM swap).
 * Content script hooks history.pushState and will re-sync.
 */
export async function spaNavigate(
  page: Page,
  target: { kind: 'channel'; login: string } | { kind: 'vod'; vodId: string; login?: string },
  htmlKind: TwitchFixtureKind,
): Promise<void> {
  const html = readFixture(htmlKind)
  const path =
    target.kind === 'channel' ? `/${target.login}` : `/videos/${target.vodId}`

  await page.evaluate(
    ({ pathName, bodyHtml, pageTitle, kind }) => {
      document.title = pageTitle
      const parsed = new DOMParser().parseFromString(bodyHtml, 'text/html')
      // Do not re-execute fixture <script> tags — that collides with the live
      // content-script world. Stub video duration after the DOM swap instead.
      document.body.replaceChildren(...Array.from(parsed.body.childNodes))
      const video = document.querySelector('video') as HTMLVideoElement | null
      if (video) {
        const duration = kind === 'live' ? Infinity : 3600
        Object.defineProperty(video, 'duration', { configurable: true, get: () => duration })
        try {
          video.currentTime = kind === 'live' ? 1 : 120
        } catch {
          /* ignore seek failures on stub media */
        }
      }
      history.pushState({}, '', pathName)
    },
    {
      pathName: path,
      bodyHtml: html,
      pageTitle:
        target.kind === 'channel'
          ? `${target.login} - Twitch`
          : `VOD ${target.vodId} - Twitch`,
      kind: htmlKind,
    },
  )
}

/** Replace body children to simulate Twitch shell swaps without a document reload. */
export async function replaceTwitchBody(page: Page, htmlKind: TwitchFixtureKind): Promise<void> {
  const html = readFixture(htmlKind)
  await page.evaluate(bodyHtml => {
    const parsed = new DOMParser().parseFromString(bodyHtml, 'text/html')
    document.body.replaceChildren(...Array.from(parsed.body.childNodes))
  }, html)
}

/** Hard wipe body markup; overlay hosts on documentElement must survive and stay unique. */
export async function wipeTwitchBody(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.body.innerHTML = '<main id="twitch-root-wiped"></main>'
  })
}
