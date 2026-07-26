import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { HubSearch } from '../src/ui/components/hub/HubSearch'

const mockApiClient = vi.fn()
const mockSearchChannelSuggestions = vi.fn()
const mockLookupChannelSuggestion = vi.fn()

vi.mock('../src/lib/apiClient', () => ({
  apiClient: (...args: unknown[]) => mockApiClient(...args),
}))

vi.mock('../src/lib/channelSearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/channelSearch')>()
  return {
    ...actual,
    searchChannelSuggestions: (...args: unknown[]) => mockSearchChannelSuggestions(...args),
    lookupChannelSuggestion: (...args: unknown[]) => mockLookupChannelSuggestion(...args),
  }
})

function renderHubSearch(props: Partial<ComponentProps<typeof HubSearch>> = {}) {
  return render(
    <MemoryRouter initialEntries={['/analytics']}>
      <Routes>
        <Route
          path="/analytics"
          element={
            <HubSearch
              suggestions={[{ login: 'xqc', displayName: 'xQc', live: true, viewers: 50_000 }]}
              showKbd
              showOpenButton
              validateChannel={false}
              placeholder="Search channels…"
              {...props}
            />
          }
        />
        <Route path="/analytics/:login" element={<div data-testid="channel-page">console</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HubSearch', () => {
  beforeEach(() => {
    mockApiClient.mockReset()
    mockSearchChannelSuggestions.mockReset()
    mockLookupChannelSuggestion.mockReset()
    mockSearchChannelSuggestions.mockResolvedValue([])
    mockLookupChannelSuggestion.mockResolvedValue(null)
  })

  it('does not show suggestion list on focus before typing', () => {
    renderHubSearch()
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('shows suggestions after typing', () => {
    renderHubSearch()
    fireEvent.change(screen.getByPlaceholderText(/search channels/i), {
      target: { value: 'x' },
    })
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(screen.getByRole('option', { name: /xQc/i })).toBeTruthy()
  })

  it('includes offline remote search matches while typing', async () => {
    renderHubSearch({ suggestions: [{ login: 'xqc', displayName: 'xQc', live: false }] })
    mockSearchChannelSuggestions.mockResolvedValueOnce([
      {
        login: 'xqc',
        displayName: 'xQc',
        live: false,
        profileImageUrl: 'https://avatar/xqc.png',
      },
    ])
    fireEvent.change(screen.getByPlaceholderText(/search channels/i), {
      target: { value: 'xqc' },
    })
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /xQc/i })).toBeTruthy()
    })
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /xQc/i }).querySelector('img')?.getAttribute('src')).toBe(
        'https://avatar/xqc.png',
      )
    })
    expect(screen.getByText('Offline')).toBeTruthy()
    expect(mockSearchChannelSuggestions).toHaveBeenCalledWith('xqc', 8)
  })

  it('navigates without channel metadata lookup when validateChannel is false', () => {
    renderHubSearch()
    fireEvent.change(screen.getByPlaceholderText(/search channels/i), {
      target: { value: 'newchannel' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^open$/i }))
    expect(screen.getByTestId('channel-page')).toBeTruthy()
    expect(mockApiClient).not.toHaveBeenCalled()
  })

  it('focuses input on Cmd+K shortcut when showKbd is enabled', () => {
    renderHubSearch()
    const input = screen.getByRole('combobox')
    expect(document.activeElement).not.toBe(input)
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(document.activeElement).toBe(input)
  })
})
