import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ClipsPage from '../src/routes/dashboard/Clips'

describe('ClipsPage', () => {
  beforeEach(() => {
    localStorage.setItem('sp.betaKey', 'secret-one')
    vi.restoreAllMocks()
  })

  it('renders candidates with source warnings and private review actions', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/v1/pulse/clips/cc_available/replayforge')) {
        expect(init?.method).toBe('POST')
        return new Response(
          JSON.stringify({
            id: 'ccj_available',
            candidateId: 'cc_available',
            status: 'queued',
            replayForgeJobId: 'rf_available',
            replayForgeState: 'queued',
          }),
          { status: 202 },
        )
      }
      if (url.includes('/v1/pulse/clips/cc_missing')) {
        expect(init?.method).toBe('PATCH')
        return new Response(
          JSON.stringify({
            id: 'ccs_missing',
            candidateId: 'cc_missing',
            status: 'saved',
          }),
          { status: 200 },
        )
      }
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'cc_available',
              login: 'xqc',
              streamId: 'stream-2',
              vodId: 'vod-2',
              streamTitle: 'Playable set',
              streamCategory: 'Just Chatting',
              offsetSeconds: 220,
              startSeconds: 200,
              endSeconds: 260,
              score: 95,
              confidence: 0.88,
              reason: 'chat_spike',
              sourceKind: 'recap',
              sourceStatus: 'available',
              coverageState: 'ready',
              chatCount: 260,
              emoteCount: 210,
              topEmotes: [{ name: 'OMEGALUL', provider: 'bttv', count: 70 }],
              state: { status: 'new' },
            },
            {
              id: 'cc_missing',
              login: 'xqc',
              streamId: 'stream-1',
              streamTitle: 'Late night set',
              streamCategory: 'Just Chatting',
              offsetSeconds: 120,
              startSeconds: 100,
              endSeconds: 160,
              score: 93,
              confidence: 0.82,
              reason: 'emote_spike',
              sourceKind: 'recap',
              sourceStatus: 'missing',
              coverageState: 'partial',
              chatCount: 240,
              emoteCount: 190,
              topEmotes: [
                {
                  name: 'KEKW',
                  provider: 'seventv',
                  count: 90,
                  imageUrl: 'https://cdn.example/kekw.webp',
                },
              ],
              state: { status: 'new' },
            },
          ],
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MemoryRouter>
        <ClipsPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: /streamPulse clips/i })).toBeTruthy()
    expect(screen.getByText('Playable set')).toBeTruthy()
    expect(screen.getByText('Late night set')).toBeTruthy()
    expect(screen.getByText('Emote spike')).toBeTruthy()
    expect(screen.getByText('KEKW')).toBeTruthy()
    expect(screen.getByText(/Needs source/i)).toBeTruthy()
    const availableCard = screen.getByText('Playable set').closest('article') as HTMLElement
    const missingCard = screen.getByText('Late night set').closest('article') as HTMLElement
    expect((within(missingCard).getByRole('button', { name: /render/i }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(missingCard).getByRole('button', { name: /export/i }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(missingCard).getByRole('button', { name: /replayforge blocked/i }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(within(missingCard).getByRole('button', { name: /save/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getAllByText(/^Saved$/).length).toBeGreaterThanOrEqual(2))

    fireEvent.click(within(availableCard).getByRole('button', { name: /send to replayforge/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(await screen.findByText(/Rendering queued/i)).toBeTruthy()
  })

  it('shows an honest empty state when no candidates exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })),
    )

    render(
      <MemoryRouter>
        <ClipsPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText(/no clip candidates yet/i)).toBeTruthy()
  })

  it('hydrates persisted ReplayForge job state from candidates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'cc_queued',
                login: 'xqc',
                streamId: 'stream-queued',
                vodId: 'vod-queued',
                streamTitle: 'Already queued',
                offsetSeconds: 120,
                startSeconds: 100,
                endSeconds: 160,
                score: 90,
                reason: 'chat_spike',
                sourceKind: 'recap',
                sourceStatus: 'available',
                job: {
                  id: 'ccj_queued',
                  candidateId: 'cc_queued',
                  status: 'queued',
                  replayForgeJobId: 'rf_queued',
                  replayForgeState: 'queued',
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    )

    render(
      <MemoryRouter>
        <ClipsPage />
      </MemoryRouter>,
    )

    const card = (await screen.findByText('Already queued')).closest('article') as HTMLElement
    expect(within(card).getByText(/Rendering queued/i)).toBeTruthy()
    expect((within(card).getByRole('button', { name: /^Queued$/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('refreshes a queued ReplayForge job into ready state', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/v1/pulse/clips/cc_queued/replayforge')) {
        return new Response(
          JSON.stringify({
            id: 'ccj_queued',
            candidateId: 'cc_queued',
            status: 'ready',
            replayForgeJobId: 'rf_queued',
            replayForgeState: 'ready',
          }),
          { status: 200 },
        )
      }
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'cc_queued',
              login: 'xqc',
              streamId: 'stream-queued',
              vodId: 'vod-queued',
              streamTitle: 'Queued candidate',
              offsetSeconds: 120,
              startSeconds: 100,
              endSeconds: 160,
              score: 90,
              reason: 'chat_spike',
              sourceKind: 'recap',
              sourceStatus: 'available',
              job: {
                id: 'ccj_queued',
                candidateId: 'cc_queued',
                status: 'queued',
                replayForgeJobId: 'rf_queued',
                replayForgeState: 'queued',
              },
            },
          ],
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MemoryRouter>
        <ClipsPage />
      </MemoryRouter>,
    )

    const card = (await screen.findByText('Queued candidate')).closest('article') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: /refresh replayforge/i }))

    expect(await within(card).findByText(/Worker ready \(playback not verified\)/i)).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/v1/pulse/clips/cc_queued/replayforge'), expect.anything())
  })
})
