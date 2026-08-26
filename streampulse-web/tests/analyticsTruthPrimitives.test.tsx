import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ScreenerMetricComparison } from '../src/lib/channelScreenerContract'
import {
  EvidenceSummary,
  MetricComparison,
  MomentActionRow,
} from '../src/ui/components/analytics/AnalyticsTruthPrimitives'

const ready: ScreenerMetricComparison = {
  state: 'ready',
  currentPerMin: 25,
  baselinePerMin: 10,
  absoluteDeltaPerMin: 15,
  changePct: 150,
  multiplier: 2.5,
  currentMeasuredMinutes: 5,
  currentExpectedMinutes: 5,
  baselineMeasuredMinutes: 20,
  baselineExpectedMinutes: 20,
  baselineCoveragePct: 100,
}

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand')

afterEach(() => {
  vi.restoreAllMocks()
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
  else Reflect.deleteProperty(navigator, 'clipboard')
  if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand)
  else Reflect.deleteProperty(document, 'execCommand')
})

describe('analytics truth primitives', () => {
  it('uses percentage for chat and multiplier for emotes without changing source values', () => {
    const { rerender } = render(<MetricComparison label="Chat" comparison={ready} tone="chat" presentation="percentage" />)
    expect(screen.getByText('+150%')).toBeTruthy()
    expect(screen.queryByText('2.5×')).toBeNull()
    rerender(<MetricComparison label="Emotes" comparison={ready} tone="emotes" presentation="multiplier" />)
    expect(screen.getByText('2.5×')).toBeTruthy()
  })

  it('explains warming evidence instead of showing a qualified delta', () => {
    render(
      <MetricComparison
        label="Chat"
        comparison={{
          ...ready,
          state: 'warming',
          reason: 'baseline_insufficient',
          currentMeasuredMinutes: 5,
          baselineMeasuredMinutes: 12,
        }}
      />,
    )
    expect(screen.getByText(/still building its measured average/)).toBeTruthy()
    expect(screen.getByText(/12\/20 min/)).toBeTruthy()
    expect(screen.getByText(/Observed rates/)).toBeTruthy()
    expect(screen.queryByText('+150%')).toBeNull()
  })

  it('shows exact collection evidence and the diagnostic code', () => {
    render(
      <EvidenceSummary
        evidence={{ ircBound: true, chatObservedLast5m: false, rollupAvailable: true, metadataAgeSeconds: 75 }}
        currentMeasuredMinutes={4}
        currentExpectedMinutes={5}
        baselineMeasuredMinutes={18}
        baselineExpectedMinutes={20}
        baselineCoveragePct={90}
        diagnosticReason="current_window_incomplete"
        defaultOpen
      />,
    )
    expect(screen.getByText('4/5 min')).toBeTruthy()
    expect(screen.getByText('90%')).toBeTruthy()
    expect(screen.getByText('current_window_incomplete')).toBeTruthy()
  })

  it('keeps all three moment actions aligned and names missing replay honestly', () => {
    render(
      <MemoryRouter>
        <MomentActionRow analyticsHref="/analytics/x/1#t=30" copyHref="/analytics/x/1#t=30" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Analytics' })).toBeTruthy()
    expect(screen.getByText('Replay unavailable')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
  })

  it('falls back to a selection copy when the Clipboard API is denied', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('permission denied'))
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })
    render(
      <MemoryRouter>
        <MomentActionRow analyticsHref="/analytics/x/1#t=30" copyHref="/analytics/x/1#t=30" />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy())
    expect(writeText).toHaveBeenCalledOnce()
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(screen.getByRole('status').textContent).toContain('Link copied to clipboard')
    expect(document.querySelector('textarea[aria-hidden="true"]')).toBeNull()
  })

  it('reports clipboard failure instead of silently returning to Copy link', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('permission denied')) },
    })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    })
    render(
      <MemoryRouter>
        <MomentActionRow analyticsHref="/analytics/x/1#t=30" copyHref="/analytics/x/1#t=30" />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy failed' })).toBeTruthy())
    expect(screen.getByRole('status').textContent).toContain('Could not copy the link')
  })
})
