import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { AnalyticsStream } from '../../apiTypes.ts'
import { StreamSidebar } from './StreamSidebar.tsx'

afterEach(() => cleanup())

const streams = Array.from({ length: 6 }, (_, index) => ({
  streamId: String(200 + index),
  login: 'xqc',
  startedAt: new Date(Date.parse('2026-10-01T18:00:00.000Z') - index * 86_400_000).toISOString(),
  title: `Broadcast ${index + 1}`,
})) as AnalyticsStream[]

describe('StreamSidebar collapse breakpoint', () => {
  it('collapses the list wherever the console stacks it under the chart (below xl)', () => {
    // The console grid only goes multi-column at xl; below that the list sits
    // under the chart and must stay collapsed behind "Show all".
    const consoleSource = readFileSync(resolve(__dirname, '../AnalyticsConsole.tsx'), 'utf8')
    expect(consoleSource).toContain("'grid grid-cols-1 gap-4 xl:grid-cols-[240px_minmax(0,1fr)_340px]")

    const { container } = render(
      <MemoryRouter>
        <StreamSidebar
          login="xqc"
          streams={streams}
          isLiveView
          buildSessionPath={(login, id) => `/analytics/${login}/${id}`}
          buildChannelPath={login => `/analytics/${login}`}
        />
      </MemoryRouter>,
    )
    const toggle = screen.getByRole('button', { name: 'Show all 6 streams' })
    expect(toggle.className).toMatch(/\bxl:hidden\b/)
    expect(toggle.className).not.toMatch(/\blg:hidden\b/)
    const hiddenRows = container.querySelectorAll('.hidden')
    expect(hiddenRows.length).toBeGreaterThan(0)
    for (const row of hiddenRows) {
      expect(row.className).toMatch(/\bxl:block\b/)
      expect(row.className).not.toMatch(/\blg:block\b/)
    }
    fireEvent.click(toggle)
    expect(container.querySelectorAll('.hidden.xl\\:block')).toHaveLength(0)
  })

  it('d3-v2 session page: no live row when switched off, the current row marked and kept in view while collapsed', () => {
    const props = {
      login: 'xqc',
      streams,
      isLiveView: false,
      activeID: '205',
      buildSessionPath: (login: string, id: string) => `/analytics/${login}/${id}`,
      buildChannelPath: (login: string) => `/analytics/${login}`,
    }
    const { container, rerender } = render(<MemoryRouter><StreamSidebar {...props} /></MemoryRouter>)
    // Default for package consumers: prod's live row stays.
    expect(container.querySelector('[data-live-current-row]')).not.toBeNull()
    rerender(<MemoryRouter><StreamSidebar {...props} showLiveRow={false} /></MemoryRouter>)
    expect(container.querySelector('[data-live-current-row]')).toBeNull()
    expect(screen.queryByText('Latest indexed session')).toBeNull()
    const current = container.querySelector<HTMLElement>('[aria-current="page"]')!
    expect(current.getAttribute('href')).toBe('/analytics/xqc/205')
    expect(current.className.split(' ')).not.toContain('hidden')
    // The list box and its scroller carry the hooks the page CSS sizes from 1280 px.
    expect(container.querySelector('.ssp-sl[data-stream-list] > .ssp-sl-sc')).not.toBeNull()
    // "Show all" sits under the scroller, not inside it.
    const toggle = screen.getByRole('button', { name: 'Show all 6 streams' })
    expect(toggle.closest('.ssp-sl-sc')).toBeNull()
    expect(toggle.className.split(' ')).toContain('ssp-sl-more')
  })
})
