import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OpenAllSettingsButton, PulseSettingsPanel, SupporterHero, type QuickSettingsChannel } from '../src/ui/PulseSettingsPanel.tsx'

const LIVE: QuickSettingsChannel = {
  login: 'xqc',
  displayName: 'xQc',
  isLive: true,
  category: 'Grand Theft Auto V',
  viewerCount: 28_231,
  startedAt: new Date(Date.now() - (8 * 60 + 35) * 60_000).toISOString(),
  surface: 'live_tracked',
}

describe('PulseSettingsPanel quick workspace', () => {
  it('keeps everyday controls inline and the three-item changelog collapsed by default', () => {
    const html = renderToStaticMarkup(<PulseSettingsPanel />)
    expect(html).toContain('Refresh live data automatically')
    expect(html).toContain('Auto-update')
    expect(html).toContain('Accent')
    expect(html).toContain('Appearance preview')
    expect(html).toContain('data-appearance-preview="true"')
    expect(html).toContain('Placement')
    expect(html).toContain('Density')
    expect(html).not.toContain('Default chart range')
    expect(html).toContain('Dock when chat is closed')
    expect(html).toContain('Reset appearance and layout to defaults')
    expect(html).toContain('data-settings-connection="true"')
    expect(html).toContain('data-changelog-preview="true"')
    expect(html).toMatch(/<summary><span class="pulse-settings-release-version">.*?<\/summary>/)
    expect(html).toContain('Background &amp; motion')
    expect(html).toContain('data-banner-editor-cta="true"')
    expect(html).not.toContain('<details class="pulse-banner-customize"')
    expect(html).not.toContain('Panel title')
    expect(html).toContain('pulse-settings-release-body pulse-tab-fade')
    expect(html.match(/<li>/g)).toHaveLength(3)
    expect(html).toContain('View full changelog ↗')
    expect(html).toContain('data-settings-host-cta="updates"')
    expect(html).not.toContain('Privacy &amp; Data')
    // "Open all settings" is pinned outside the scrolling panel, like the Pulse view's Settings bar.
    expect(html).not.toContain('Open all settings')
    expect(html).not.toContain('data-settings-host-cta="pulse"')
    expect(html.indexOf('data-settings-connection="true"')).toBeLessThan(html.indexOf('Refresh live data automatically'))
    expect(html.indexOf('Refresh live data automatically')).toBeLessThan(html.indexOf('Background &amp; motion'))
  })

  it('pins Open all settings as its own bar that opens the Pulse section', () => {
    const html = renderToStaticMarkup(<OpenAllSettingsButton />)
    expect(html).toContain('Open all settings')
    expect(html).toContain('data-settings-host-cta="pulse"')
    expect(html).toContain('class="pulse-settings-bottom-bar"')
  })

  it('opens on the channel being watched, in plain language', () => {
    const html = renderToStaticMarkup(<PulseSettingsPanel channel={LIVE} />)
    expect(html).toContain('Watching')
    expect(html).toContain('<strong>xQc</strong>')
    expect(html).toContain('Grand Theft Auto V · live 8h 35m')
    expect(html).toContain('<b>LIVE</b>')
    expect(html).toContain('28.2K')
    expect(html).toContain('data-live="true"')
    // No avatar on the page in tests, so the card falls back to a monogram.
    expect(html).toMatch(/class="pulse-settings-channel-avatar" aria-hidden="true">X</)
    // Build version and backend sampler health stay out of the channel card.
    expect(html).not.toContain('Sampler')
    expect(html).not.toMatch(/Connected · v/)
    expect(html.indexOf('<strong>xQc</strong>')).toBeLessThan(html.indexOf('data-settings-connection="true"'))
  })

  it('describes an offline channel without a live badge or a viewer count', () => {
    const html = renderToStaticMarkup(<PulseSettingsPanel channel={{ ...LIVE, isLive: false, viewerCount: null, surface: 'offline_recap' }} />)
    expect(html).toContain('Replay')
    expect(html).not.toContain('<b>LIVE</b>')
    expect(html).not.toContain('data-live')
    expect(html).not.toContain('live 8h')
    const visiting = renderToStaticMarkup(<PulseSettingsPanel channel={{ ...LIVE, isLive: false, surface: 'offline_empty' }} />)
    expect(visiting).toContain('Visiting')
  })

  it('leaves out an uptime that a stale start time would make impossible', () => {
    const stale = renderToStaticMarkup(<PulseSettingsPanel channel={{ ...LIVE, startedAt: new Date(Date.now() - 49 * 3_600_000).toISOString() }} />)
    expect(stale).toContain('Grand Theft Auto V')
    expect(stale).not.toContain(' · live ')
  })

  it('puts Supporter right under the channel card, ahead of every control', () => {
    const html = renderToStaticMarkup(<PulseSettingsPanel channel={LIVE} />)
    expect(html).toContain('data-settings-host-cta="supporter"')
    expect(html).toContain('Pulse Supporter')
    expect(html).toContain('Core tools stay free')
    expect(html).toContain('Explore Supporter')
    expect(html).not.toContain('data-supporter-verified')
    expect(html.indexOf('data-settings-connection="true"'))
      .toBeLessThan(html.indexOf('data-settings-host-cta="supporter"'))
    expect(html.indexOf('data-settings-host-cta="supporter"'))
      .toBeLessThan(html.indexOf('aria-label="Extension preferences"'))
  })

  it('draws the Supporter card as a decorative neon tube and loads no emotes until someone shows interest', () => {
    const html = renderToStaticMarkup(<SupporterHero finish={null} onOpen={() => {}} />)
    expect(html).toMatch(/<span class="pulse-settings-supporter-sign" aria-hidden="true"><svg/)
    expect(html.match(/class="pulse-sign-(glass|bloom|neon|beam|spark)"/g)).toHaveLength(5)
    expect(html).not.toContain('<img')
    expect(html).not.toContain('cdn.7tv.app')
    expect(html).not.toContain('data-finish')
  })

  it('acknowledges a worker-verified finish and otherwise stays neutral', () => {
    const verified = renderToStaticMarkup(<SupporterHero finish="etched" onOpen={() => {}} />)
    expect(verified).toContain('data-supporter-verified="true"')
    expect(verified).toContain('data-finish="etched"')
    expect(verified).toContain('Etched finish equipped')
    expect(verified).toContain('Manage Supporter')
    expect(verified).not.toContain('Explore Supporter')
    const neutral = renderToStaticMarkup(<SupporterHero finish={null} onOpen={() => {}} />)
    expect(neutral).toContain('Explore Supporter')
    expect(neutral).not.toContain('equipped')
  })

  it('groups quick controls into titled cards', () => {
    const html = renderToStaticMarkup(<PulseSettingsPanel />)
    expect(html.match(/class="pulse-quick-group-card"/g)).toHaveLength(3)
    for (const title of ['Live data', 'Layout', 'Appearance']) {
      expect(html).toContain(`<h2 class="pulse-quick-group-title">${title}</h2>`)
    }
  })

  /**
   * The overlay cannot read entitlement: SUPPORTER_ENTITLEMENT is scoped to
   * extension pages. So this surface must not state a price, claim a membership,
   * or carry a purchase link — a reader who already pays would be shown a sales
   * pitch, and a reader who does not would be given a price with no honest
   * status beside it. It opens the settings section instead, where real status
   * is known.
   */
  it('never states a price, a membership claim, or an external link', () => {
    const html = renderToStaticMarkup(<PulseSettingsPanel />)
    for (const forbidden of ['4.99', '$', 'per month', '/month', 'Become a Supporter', 'Subscribe', 'Upgrade']) {
      expect(html, `overlay must not contain ${forbidden}`).not.toContain(forbidden)
    }
    // No outbound navigation at all: the content bundle deliberately excludes
    // the portal link registry, and its gzip headroom is measured in hundreds
    // of bytes.
    expect(html).not.toMatch(/href="https?:\/\//)
    expect(html).not.toContain('streampulse.stream')
    expect(html).not.toContain('<a ')
  })
})
