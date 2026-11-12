import { expect, test as base } from '@playwright/test'

export * from '@playwright/test'

/**
 * The `test` every portal-mocked spec imports. A context route sits under the
 * spec's own page.route() handlers and the acceptance harness (page routes
 * always run first), so it only sees requests nothing else answered:
 * loopback goes through, emote and avatar CDNs get a 1x1 PNG, and anything
 * else is aborted and fails the test. A mocked run never reaches the live API
 * or a real image host.
 */

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
const IMAGE_HOSTS = new Set(['cdn.7tv.app', 'cdn.betterttv.net', 'cdn.frankerfacez.com', 'static-cdn.jtvnw.net'])

export interface NetworkGuard {
  /** Refused requests as "METHOD url". The test fails unless this is empty when it ends. */
  readonly refused: string[]
}

export const test = base.extend<{ networkGuard: NetworkGuard }>({
  networkGuard: [
    async ({ context }, use) => {
      const refused: string[] = []
      await context.route('**/*', async (route) => {
        const request = route.request()
        const { hostname } = new URL(request.url())
        if (LOOPBACK_HOSTS.has(hostname)) return route.continue()
        if (IMAGE_HOSTS.has(hostname)) return route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG })
        refused.push(`${request.method()} ${request.url()}`)
        await route.abort('blockedbyclient')
      })
      await context.routeWebSocket(
        (url) => !LOOPBACK_HOSTS.has(url.hostname),
        (ws) => {
          refused.push(`WS ${ws.url()}`)
          void ws.close()
        },
      )
      await use({ refused })
      expect(refused, 'portal-mocked specs must route every request that leaves loopback').toEqual([])
    },
    { auto: true },
  ],
})
