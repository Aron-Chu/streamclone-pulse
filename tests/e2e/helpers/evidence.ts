import type { BrowserContext, ConsoleMessage, Page, Request, TestInfo, Worker } from '@playwright/test'

export interface EvidenceCollectors {
  pageConsole: string[]
  serviceWorkerConsole: string[]
  failedRequests: Array<{ url: string; method: string; failure: string | null; status: number | null }>
  pageErrors: string[]
  attachAll: (testInfo: TestInfo) => Promise<void>
  dispose: () => void
}

function formatConsole(msg: ConsoleMessage): string {
  return `[${msg.type()}] ${msg.text()}`
}

/**
 * Capture page console, SW console, page errors, and failed network requests.
 * Call attachAll from test.afterEach when the test failed.
 */
export function installEvidenceCollectors(
  context: BrowserContext,
  page: Page,
  serviceWorker: Worker,
): EvidenceCollectors {
  const pageConsole: string[] = []
  const serviceWorkerConsole: string[] = []
  const failedRequests: EvidenceCollectors['failedRequests'] = []
  const pageErrors: string[] = []

  const onPageConsole = (msg: ConsoleMessage) => {
    pageConsole.push(formatConsole(msg))
  }
  const onPageError = (err: Error) => {
    pageErrors.push(err.stack ?? err.message)
  }
  const onRequestFailed = (request: Request) => {
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText ?? null,
      status: null,
    })
  }
  const onResponse = async (response: import('@playwright/test').Response) => {
    if (response.status() >= 400) {
      failedRequests.push({
        url: response.url(),
        method: response.request().method(),
        failure: null,
        status: response.status(),
      })
    }
  }
  const onSwConsole = (msg: ConsoleMessage) => {
    serviceWorkerConsole.push(formatConsole(msg))
  }

  page.on('console', onPageConsole)
  page.on('pageerror', onPageError)
  page.on('requestfailed', onRequestFailed)
  page.on('response', onResponse)
  serviceWorker.on('console', onSwConsole)

  // Attach console listeners to future service workers after restart.
  const onWorker = (worker: Worker) => {
    if (!worker.url().startsWith('chrome-extension://')) return
    worker.on('console', onSwConsole)
  }
  context.on('serviceworker', onWorker)

  return {
    pageConsole,
    serviceWorkerConsole,
    failedRequests,
    pageErrors,
    async attachAll(testInfo) {
      await testInfo.attach('page-console.log', {
        body: pageConsole.join('\n') || '(empty)',
        contentType: 'text/plain',
      })
      await testInfo.attach('service-worker-console.log', {
        body: serviceWorkerConsole.join('\n') || '(empty)',
        contentType: 'text/plain',
      })
      await testInfo.attach('failed-network.json', {
        body: JSON.stringify(failedRequests, null, 2),
        contentType: 'application/json',
      })
      await testInfo.attach('page-errors.log', {
        body: pageErrors.join('\n') || '(empty)',
        contentType: 'text/plain',
      })
    },
    dispose() {
      page.off('console', onPageConsole)
      page.off('pageerror', onPageError)
      page.off('requestfailed', onRequestFailed)
      page.off('response', onResponse)
      serviceWorker.off('console', onSwConsole)
      context.off('serviceworker', onWorker)
    },
  }
}
