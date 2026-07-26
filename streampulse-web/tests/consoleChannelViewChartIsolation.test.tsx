import { act, render, screen } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const consoleRenderCount = vi.fn()
let bumpStatusTone: (() => void) | null = null

vi.mock('@streampulse/analytics-console', () => ({
  AnalyticsConsole: () => {
    consoleRenderCount()
    return <div data-testid="analytics-console">console</div>
  },
}))

vi.mock('../src/lib/streamcloneAnalytics', () => ({
  setupStreamcloneAnalyticsApi: () => undefined,
  usesLocalAnalyticsBackend: () => false,
}))

vi.mock('../src/ui/motion/useAnalyticsMotion', () => ({
  useAnalyticsMotion: () => ({ fadeThemeCenter: () => undefined }),
}))

vi.mock('../src/ui/components/analytics/HubBackendSourceBanner', () => ({
  HubBackendSourceBanner: () => null,
}))

vi.mock('../src/ui/components/analytics/AnalyticsFigmaShell', () => ({
  AnalyticsFigmaShell: ({
    children,
    backendStatus,
  }: {
    children: ReactNode
    backendStatus?: { tone?: string }
  }) => (
    <div data-testid="figma-shell" data-tone={backendStatus?.tone ?? ''}>
      {children}
    </div>
  ),
}))

vi.mock('../src/lib/apiClient', () => ({
  getBackendUrl: () => 'https://api.streampulse.stream',
}))

vi.mock('../src/lib/backendSource', () => ({
  resolveBackendSource: () => 'hosted',
  backendSourceLabel: () => 'hosted',
}))

vi.mock('../src/hooks/usePublicStatusProbe', () => ({
  usePublicStatusProbe: () => {
    const [tick, setTick] = useState(0)
    bumpStatusTone = () => setTick((n) => n + 1)
    return {
      tone: tick === 0 ? 'ready' : 'degraded',
      loading: false,
      error: null,
      status: tick === 0 ? 'operational' : 'degraded',
      degraded: tick > 0,
    }
  },
}))

import ConsoleChannelView from '../src/routes/analytics/ConsoleChannelView'

describe('ConsoleChannelView chart isolation (P4-L03 / P4-L05)', () => {
  beforeEach(() => {
    consoleRenderCount.mockClear()
    bumpStatusTone = null
  })

  it('does not re-render AnalyticsConsole when only shell status tone changes', async () => {
    render(
      <MemoryRouter initialEntries={['/analytics/xqc/2026-07-11']}>
        <Routes>
          <Route path="/analytics/:login/:streamId" element={<ConsoleChannelView />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('analytics-console')).toBeTruthy()
    const initialRenders = consoleRenderCount.mock.calls.length
    expect(initialRenders).toBeGreaterThan(0)
    expect(bumpStatusTone).toBeTypeOf('function')

    await act(async () => {
      bumpStatusTone?.()
    })

    expect(consoleRenderCount.mock.calls.length).toBe(initialRenders)
  })
})
