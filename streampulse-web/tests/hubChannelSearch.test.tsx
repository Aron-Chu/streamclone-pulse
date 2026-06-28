import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { HubChannelSearch } from '../src/ui/components/analytics/HubChannelSearch'

const mockApiClient = vi.fn()

vi.mock('../src/lib/apiClient', () => ({
  apiClient: (...args: unknown[]) => mockApiClient(...args),
}))

function renderSearch(initialPath = '/analytics') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/analytics" element={<HubChannelSearch />} />
        <Route path="/analytics/:login" element={<div data-testid="channel-page">console</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HubChannelSearch', () => {
  beforeEach(() => {
    mockApiClient.mockReset()
  })

  it('navigates to channel analytics after successful lookup', async () => {
    mockApiClient.mockResolvedValue({ status: 200, data: { login: 'xqc' } })
    renderSearch()
    fireEvent.change(screen.getByPlaceholderText(/paste a twitch login/i), { target: { value: 'xqc' } })
    fireEvent.click(screen.getByRole('button', { name: /open analytics/i }))
    await waitFor(() => {
      expect(screen.getByTestId('channel-page')).toBeTruthy()
    })
    expect(mockApiClient).toHaveBeenCalledWith('/v1/channels/xqc')
  })

  it('shows error when channel is missing', async () => {
    mockApiClient.mockRejectedValue({ kind: 'bad_request', status: 404, message: 'HTTP 404' })
    renderSearch()
    fireEvent.change(screen.getByPlaceholderText(/paste a twitch login/i), { target: { value: 'notrealchannelxyz' } })
    fireEvent.click(screen.getByRole('button', { name: /open analytics/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/not found/i)
    })
  })
})
