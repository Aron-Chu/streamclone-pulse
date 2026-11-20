import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Landing from '../src/routes/public/Landing'

// Counts how often the tour's code is fetched. The tour mounts only in view,
// which the test IntersectionObserver never reports, so a cold visit loads none.
const showcase = vi.hoisted(() => ({ loads: 0 }))
vi.mock('../src/ui/components/landing/ExtensionShowcase', () => {
  showcase.loads += 1
  return { ExtensionShowcase: () => null }
})

vi.mock('../src/lib/publicHub', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/publicHub')>()
  const hub = {
    generatedAt: new Date().toISOString(),
    poolSize: 0,
    corpus: {},
    coverage: {},
    activity: { points: [], windowMinutes: 30, channelCount: 0 },
    emoteIntel: {},
    topEmotes: [{ name: 'KEKW', provider: '7tv', count: 900, sharePct: 22 }],
    topMovers: [],
    liveChannels: [],
    moments: [],
  }
  return { ...actual, fetchPublicHubBase: () => Promise.resolve({ data: hub, loadSource: 'full' as const, hubEndpointOk: true }) }
})

/** Answers matchMedia as allowing motion (or not); restored after each test. */
function stubMotion(motion: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string): MediaQueryList => ({
    matches: motion && query === '(prefers-reduced-motion: no-preference)',
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}

function renderLanding() {
  return render(<MemoryRouter><Landing /></MemoryRouter>)
}

afterEach(() => {
  vi.restoreAllMocks()
})

/** Longer than the first screen's own deadline (3 s after load) plus its idle callback. */
const pastFirstScreen = () => new Promise((resolve) => setTimeout(resolve, 3600))

// In this order: the tour's module loads once per file.
describe('landing decorations after the first screen', () => {
  it('starts the rain on the client once the first screen is idle, and a visit fetches no tour code until the tour is in view', async () => {
    stubMotion(true)
    const { container } = renderLanding()
    await screen.findByRole('heading', { name: /actually reacted to/i })
    expect(container.querySelector('.sl-em img')).toBeNull()
    await waitFor(() => expect(container.querySelectorAll('.sl-em img')).toHaveLength(18), { timeout: 5000 })
    window.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(showcase.loads).toBe(0)
    expect(container.querySelector('.sl-demo-placeholder')).not.toBeNull()
  })

  it('never mounts the rain under reduced motion', async () => {
    stubMotion(false)
    const { container } = renderLanding()
    await screen.findByRole('heading', { name: /actually reacted to/i })
    await act(async () => { await pastFirstScreen() })
    expect(container.querySelector('.sl-fx')).toBeNull()
    expect(container.querySelector('.sl-em img')).toBeNull()
  })
})
