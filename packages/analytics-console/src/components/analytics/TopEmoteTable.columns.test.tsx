import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsTopEmote } from '../../apiTypes.ts'
import { TopEmoteTable } from './TopEmoteTable.tsx'

afterEach(() => cleanup())

const emotes = [
  { key: 'seventv:1:LOL', name: 'LOL', count: 27_500, provider: 'seventv' },
  { key: 'twitch:2:xqcL', name: 'xqcL', count: 534, provider: 'twitch' },
  { key: 'bttv:3:catJAM', name: 'catJAM', count: 12, provider: 'bttv' },
] as AnalyticsTopEmote[]

const columns = (element: Element) =>
  element.className.split(/\s+/).find(name => name.startsWith('grid-cols-'))

describe('TopEmoteTable columns', () => {
  it('uses one fixed column template for the header and every row', () => {
    const { container } = render(
      <TopEmoteTable emotes={emotes} selected={new Set()} plottedKeys={[]} onSelect={vi.fn()} />,
    )
    const header = screen.getByText('Provider').parentElement!
    const rows = [...container.querySelectorAll('button')]
    expect(rows).toHaveLength(3)
    const template = columns(header)
    // Auto-sized columns let each row pick its own widths, so the Provider and
    // Uses columns zig-zagged from row to row.
    expect(template).toBe('grid-cols-[minmax(0,1fr)_4.5rem_3.5rem]')
    expect(template).not.toContain('auto')
    for (const row of rows) expect(columns(row)).toBe(template)
  })
})
