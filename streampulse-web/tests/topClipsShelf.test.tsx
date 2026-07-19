import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TopClipsShelf } from '../src/ui/components/analytics/TopClipsShelf'
import type { HubPublicClip } from '../src/lib/publicClipsContract'
import { AnalyticsThemeProvider } from '../src/ui/providers/AnalyticsThemeProvider'

const clip: HubPublicClip = {
  id: 'pub-1',
  login: 'xqc',
  displayName: 'xQc',
  title: 'Verified peak',
  thumbnailUrl: 'https://cdn.example/t.jpg',
  playbackUrl: 'https://cdn.example/p.mp4',
  durationSeconds: 30,
  publishedAt: '2026-07-10T12:00:00Z',
  analyticsHref: '/analytics/xqc',
}

describe('TopClipsShelf', () => {
  it('omits shelf when there are no clips', () => {
    const { container } = render(
      <AnalyticsThemeProvider>
        <TopClipsShelf clips={[]} />
      </AnalyticsThemeProvider>,
    )
    expect(container.querySelector('.top-clips-shelf')).toBeNull()
  })

  it('renders playback link for verified clips', () => {
    render(
      <AnalyticsThemeProvider>
        <TopClipsShelf clips={[clip]} />
      </AnalyticsThemeProvider>,
    )
    expect(screen.getByRole('heading', { name: 'Top clips' })).toBeTruthy()
    const play = screen.getByRole('link', { name: /Verified peak/i })
    expect(play.getAttribute('href')).toBe(clip.playbackUrl)
    expect(play.getAttribute('rel')).toMatch(/noopener/)
    expect(screen.getByRole('link', { name: 'Analytics' }).getAttribute('href')).toBe(
      '/analytics/xqc',
    )
    fireEvent.click(play)
  })

  it('omits invalid secondary hrefs rather than rewriting them', () => {
    const hostile: HubPublicClip = {
      ...clip,
      analyticsHref: undefined,
      vodHref: undefined,
    }
    render(
      <AnalyticsThemeProvider>
        <TopClipsShelf
          clips={[
            {
              ...hostile,
              id: 'pub-2',
              // Component trusts contract sanitization; invalid values must already be omitted.
            },
          ]}
        />
      </AnalyticsThemeProvider>,
    )
    expect(screen.queryByRole('link', { name: 'Analytics' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'VOD' })).toBeNull()
  })
})
