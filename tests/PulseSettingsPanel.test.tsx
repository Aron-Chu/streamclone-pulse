import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PulseSettingsPanel } from '../src/ui/PulseSettingsPanel.tsx'

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
    expect(html).toContain('Open all settings')
    expect(html).toContain('data-settings-host-cta="updates"')
    expect(html).toContain('data-settings-host-cta="pulse"')
    expect(html).not.toContain('Privacy &amp; Data')
    expect(html.indexOf('data-settings-connection="true"')).toBeLessThan(html.indexOf('data-settings-host-cta="pulse"'))
    expect(html.indexOf('data-settings-host-cta="pulse"')).toBeLessThan(html.indexOf('Refresh live data automatically'))
    expect(html.indexOf('Refresh live data automatically')).toBeLessThan(html.indexOf('Background &amp; motion'))
  })

  it('surfaces Supporter as a destination without pitching a purchase', () => {
    const html = renderToStaticMarkup(<PulseSettingsPanel />)
    expect(html).toContain('data-settings-host-cta="supporter"')
    expect(html).toContain('Pulse Supporter')
    expect(html).toContain('Core tools stay free')
    expect(html.indexOf('aria-label="Extension preferences"'))
      .toBeLessThan(html.indexOf('data-settings-host-cta="supporter"'))
    expect(html.indexOf('data-settings-host-cta="pulse"'))
      .toBeLessThan(html.indexOf('data-settings-host-cta="supporter"'))
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
