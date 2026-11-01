import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountChannelCard } from '../src/routes/account/AccountChannel'
import { AccountError, accountRequest } from '../src/lib/accountApi'
import { accountChannel, channelOptInEnabled } from '../src/lib/channelOptIn'
import { beginTwitchFlow } from '../src/lib/twitchSignIn'
vi.mock('../src/lib/accountApi', async importOriginal => ({ ...await importOriginal<typeof import('../src/lib/accountApi')>(), accountRequest: vi.fn() }))
vi.mock('../src/lib/twitchSignIn', async importOriginal => ({ ...await importOriginal<typeof import('../src/lib/twitchSignIn')>(), beginTwitchFlow: vi.fn() }))

const added = { login: 'pixel_parade', addedAt: '2026-11-01T18:00:00Z', status: 'active' }

beforeEach(() => { vi.mocked(accountRequest).mockReset(); vi.mocked(beginTwitchFlow).mockReset() })
afterEach(() => vi.unstubAllEnvs())

describe('channel opt-in', () => {
  it('is on only with its own flag and Sign in with Twitch', () => {
    vi.stubEnv('VITE_CHANNEL_OPTIN', '1')
    vi.stubEnv('VITE_TWITCH_SIGNIN', '')
    expect(channelOptInEnabled()).toBe(false)
    vi.stubEnv('VITE_TWITCH_SIGNIN', '1')
    expect(channelOptInEnabled()).toBe(true)
    vi.stubEnv('VITE_CHANNEL_OPTIN', 'true')
    expect(channelOptInEnabled()).toBe(false)
  })

  it('reads only a well-formed channel', () => {
    expect(accountChannel(added)).toEqual(added)
    expect(accountChannel({ ...added, status: 'revoked' })).toMatchObject({ status: 'revoked' })
    expect(accountChannel({ ...added, login: 'Not A Login' })).toBeNull()
    expect(accountChannel({ ...added, status: 'paused' })).toBeNull()
    expect(accountChannel({ ...added, addedAt: 'yesterday' })).toBeNull()
    expect(accountChannel(null)).toBeNull()
  })

  it('shows the board card when no channel is added, and starts a channel flow from it', async () => {
    vi.mocked(accountRequest).mockResolvedValue({ channel: null })
    render(<AccountChannelCard />)
    expect(await screen.findByRole('heading', { name: 'Live stats for your channel' })).toBeTruthy()
    expect(screen.getByText('Add StreamPulse and we count your chat every minute: Moments, top emotes, session recaps.')).toBeTruthy()
    expect(screen.getByText('We only read chat and never post. Remove us any time in Twitch settings → Connections.')).toBeTruthy()
    const how = screen.getByRole('button', { name: 'How it works' })
    expect(how.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(how)
    expect(how.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/It never posts\./)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add to my channel' }))
    expect(beginTwitchFlow).toHaveBeenCalledWith({ purpose: 'channel' })
    expect(accountRequest).toHaveBeenCalledWith('/channel')
  })

  it('explains a flow that could not start', async () => {
    vi.mocked(accountRequest).mockResolvedValue({ channel: null })
    vi.mocked(beginTwitchFlow).mockRejectedValue(new AccountError(503, 'request_unavailable'))
    render(<AccountChannelCard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add to my channel' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Nothing was added')
    expect(screen.getByRole('button', { name: 'Add to my channel' })).toHaveProperty('disabled', false)
  })

  it('shows an added channel and removes it', async () => {
    vi.mocked(accountRequest).mockImplementation(async path => path === '/channel' ? { channel: added } : { status: 'channel_removed' })
    render(<AccountChannelCard />)
    expect(await screen.findByText('pixel_parade')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add to my channel' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(accountRequest).toHaveBeenLastCalledWith('/channel/remove', {}))
    expect(await screen.findByText('Removed. StreamPulse stopped counting your chat.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add to my channel' })).toBeTruthy()
  })

  it('offers to add a channel again after Twitch took the permission back', async () => {
    vi.mocked(accountRequest).mockResolvedValue({ channel: { ...added, status: 'revoked' } })
    render(<AccountChannelCard />)
    expect(await screen.findByText(/Twitch took back the permission/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add to my channel' })).toBeTruthy()
  })

  it('stays hidden when the API has no channel lane', async () => {
    vi.mocked(accountRequest).mockRejectedValue(new AccountError(404))
    const { container } = render(<AccountChannelCard />)
    await waitFor(() => expect(accountRequest).toHaveBeenCalledWith('/channel'))
    await Promise.resolve()
    expect(container.innerHTML).toBe('')
  })
})
