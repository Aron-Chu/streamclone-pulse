import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { Suspense, type ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The console's code sets up its API once both of its imports have loaded (a mocked module's factory
// runs once per file, so the setup is what counts): an expired reviewed recap must not load it at all.
const { request, loads } = vi.hoisted(() => ({ request: vi.fn(), loads: { api: 0 } }))

vi.mock('../src/generated/recap-page-metadata.json', () => ({ default: {
  '/analytics/fixturechan/123': { title: 'Fixture recap', description: 'Synthetic reviewed summary metadata.', canonicalPath: '/analytics/fixturechan/123', robots: 'index,follow' },
} }))
vi.mock('../src/lib/apiClient', () => ({ apiClient: request }))
vi.mock('@streampulse/analytics-console', () => ({ AnalyticsConsole: () => <div data-testid="analytics-console">console</div> }))
vi.mock('../src/lib/streamcloneAnalytics', () => ({
  setupStreamcloneAnalyticsApi: () => { loads.api += 1 },
  usesLocalAnalyticsBackend: () => false,
}))
vi.mock('../src/ui/motion/useAnalyticsMotion', () => ({ useAnalyticsMotion: () => ({ fadeThemeCenter: () => undefined }) }))
vi.mock('../src/ui/components/analytics/HubBackendSourceBanner', () => ({ HubBackendSourceBanner: () => null }))
vi.mock('../src/ui/components/analytics/AnalyticsFigmaShell', () => ({
  AnalyticsFigmaShell: ({ children }: { children: ReactNode }) => <div data-testid="figma-shell">{children}</div>,
}))

const RECAP = '/analytics/fixturechan/123'
const STREAM_READ = '/v1/portal/analytics/streams/123'
const EXPIRED = 'Live data for this stream has expired. The reviewed summary is available above.'

/** The prerendered recap document's summary template (only those documents carry one). */
function template(path = RECAP) {
  const element = document.createElement('template')
  element.id = 'reviewed-recap-summary'
  element.dataset.canonicalPath = path
  element.innerHTML = '<article><h1>Reviewed synthetic reaction summary</h1></article>'
  document.body.appendChild(element)
}

/** The view as the channel page mounts it: its own module loaded fresh, under the page's Suspense. */
async function renderView(path = RECAP) {
  const { default: ConsoleChannelView } = await import('../src/routes/analytics/ConsoleChannelView')
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/analytics/:login/:streamId" element={<Suspense fallback={<p>Loading the page</p>}><ConsoleChannelView /></Suspense>} />
      </Routes>
    </MemoryRouter>,
  )
}
const streamReads = () => request.mock.calls.filter(([url]) => url === STREAM_READ)

beforeEach(() => {
  vi.resetModules()
  request.mockReset()
  loads.api = 0
})
afterEach(() => {
  cleanup()
  document.getElementById('reviewed-recap-summary')?.remove()
})

describe('ConsoleChannelView on a reviewed recap page', () => {
  it('shows the expired notice without loading the console when the stream has no live data', async () => {
    template()
    request.mockRejectedValue({ kind: 'bad_request', message: 'stream_not_found', status: 404 })
    await renderView()
    expect(await screen.findByText(EXPIRED)).toBeTruthy()
    expect(streamReads()).toHaveLength(1)
    // Give a stray load the chance to show itself.
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(loads.api).toBe(0)
    expect(screen.queryByTestId('analytics-console')).toBeNull()
  })

  it('mounts the full console when the stream still has live data', async () => {
    template()
    request.mockResolvedValue({ data: { stream: { streamId: '123', login: 'fixturechan' } }, status: 200 })
    await renderView()
    expect(screen.getByText('Loading the page')).toBeTruthy()
    expect(await screen.findByTestId('analytics-console')).toBeTruthy()
    expect(screen.queryByText(EXPIRED)).toBeNull()
    expect(streamReads()).toHaveLength(1)
    expect(loads.api).toBe(1)
  })

  it.each([
    ['a server error', { kind: 'server', message: 'unavailable', status: 503 }],
    ['no answer', { kind: 'unreachable', message: 'Network error', status: 0 }],
  ])('mounts the console after %s, so its own error and retry show', async (_name, failure) => {
    template()
    request.mockRejectedValue(failure)
    await renderView()
    expect(await screen.findByTestId('analytics-console')).toBeTruthy()
    expect(screen.queryByText(EXPIRED)).toBeNull()
  })
})

describe('ConsoleChannelView elsewhere', () => {
  it('starts the console code with its own, and asks nothing first, on an in-app visit to the same page', async () => {
    await renderView()
    expect(await screen.findByTestId('analytics-console')).toBeTruthy()
    expect(request).not.toHaveBeenCalled()
    expect(loads.api).toBe(1)
  })

  it('asks nothing first on a page whose template is another page’s', async () => {
    template('/analytics/someoneelse/123')
    await renderView()
    expect(await screen.findByTestId('analytics-console')).toBeTruthy()
    expect(request).not.toHaveBeenCalled()
  })
})
