import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { formatHealthVersion, PulseSettingsPanel } from '../src/ui/PulseSettingsPanel.tsx'

describe('PulseSettingsPanel release and copy presentation', () => {
  it('keeps the initial release card compact and theme-token based', () => {
    const markup = renderToStaticMarkup(<PulseSettingsPanel onBack={() => undefined} />)

    expect(markup).not.toContain('What&#x27;s new')
    expect(markup).toContain('Release history')
    expect(markup).toContain('data-settings-tab="release-history"')
    expect(markup).not.toContain('Use Release history above for the full change list.')
    expect(markup).not.toContain('data-settings-view="release-history"')
    expect(markup).not.toContain('Read full release notes')
    expect(markup).not.toContain('streampulse.stream/changelog')
    expect(markup).not.toContain('--pulse-settings-text')
    expect(markup).not.toContain('--pulse-settings-divider')
    expect(markup).not.toContain('Settings live here')
  })

  it('uses concise settings copy while retaining the important constraints', () => {
    const markup = renderToStaticMarkup(<PulseSettingsPanel onBack={() => undefined} />)

    expect(markup).toContain('Auto follows Twitch’s light/dark scheme.')
    expect(markup).toContain('Hosted live coverage uses the active IRC pool')
    expect(markup).toContain('Snapshots expire after about 45 seconds.')
    expect(markup).toContain('watchlist and server analytics stay.')
    expect(markup).toContain('>About<')
  })
})

describe('formatHealthVersion', () => {
  it('normalizes repeated version prefixes', () => {
    expect(formatHealthVersion('v0.1.26-ingest-exact-dedupe')).toBe('v0.1.26-ingest-exact-dedupe')
    expect(formatHealthVersion('vv0.1.26-ingest-exact-dedupe')).toBe('v0.1.26-ingest-exact-dedupe')
    expect(formatHealthVersion('  0.2.0  ')).toBe('v0.2.0')
    expect(formatHealthVersion(null)).toBe('Connected')
  })
})
