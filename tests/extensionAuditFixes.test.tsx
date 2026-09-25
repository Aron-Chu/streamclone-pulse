// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePulsePreferences } from '../src/ui/usePulsePreferences.ts'
import { applyAccentTheme } from '../src/ui/overlayTheme.ts'
import { SettingsWorkspace } from '../src/ui/SettingsWorkspace.tsx'
import { mergePastVodRows } from '../src/shared/pastVods.ts'
import { resolveRecapMomentMetrics } from '../src/ui/recapMomentMetrics.ts'

vi.mock('../src/content/bridge.ts', () => ({
  sendBackgroundMessage: vi.fn(async ({ type }) =>
    type === 'HEALTH'
      ? { type: 'HEALTH', ok: true }
      : { type: 'UPDATE_CHECK_CAPABILITY', supported: false, managedBy: 'development' },
  ),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('extensionAuditFixes (2026-09-04 audit resolution verification)', () => {
  let root: Root
  let host: HTMLDivElement
  let sync: Record<string, unknown>
  let listeners: Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>
  let rejectWrites: boolean

  beforeEach(() => {
    sync = { themePreference: 'volt', keepLocalCache: true }
    listeners = new Set()
    rejectWrites = false
    vi.stubGlobal('chrome', {
      runtime: { id: 'audit', getManifest: () => ({ version: '0.2.1' }) },
      storage: {
        sync: {
          get: async () => ({ ...sync }),
          set: async (items: Record<string, unknown>) => {
            if (rejectWrites) throw new Error('write failed')
            Object.assign(sync, items)
          },
        },
        local: { get: async () => ({}), set: async () => {} },
        session: {
          get: async () => ({ 'pulse:test-a': {}, 'pulse:test-b': {} }),
          remove: async () => {},
        },
        onChanged: {
          addListener: (f: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) => listeners.add(f),
          removeListener: (f: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) => listeners.delete(f),
        },
      },
    })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  })

  function Probe() {
    const p = usePulsePreferences()
    return <span data-accent={p.accent} />
  }

  it('Fix 1: options theme change repaints document accent CSS custom property', async () => {
    applyAccentTheme('volt')
    await act(async () => {
      root.render(<Probe />)
      await Promise.resolve()
    })
    expect(document.documentElement.style.getPropertyValue('--pulse-accent')).toBe('#f97316')

    sync.themePreference = 'azure'
    await act(async () => {
      for (const f of listeners) {
        f({ themePreference: { oldValue: 'volt', newValue: 'azure' } }, 'sync')
      }
      await Promise.resolve()
    })
    expect(host.querySelector('span')?.getAttribute('data-accent')).toBe('azure')
    // Repainted on document root:
    expect(document.documentElement.style.getPropertyValue('--pulse-accent')).toBe('#22d3ee')
  })

  it('Fix 2: failed cache preference save rolls back UI state and preserves cached count', async () => {
    await act(async () => {
      root.render(<SettingsWorkspace activeSection="privacy" />)
      await Promise.resolve()
    })
    const input = host.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(input.checked).toBe(true)
    expect(host.textContent).toContain('2 cached channels')

    rejectWrites = true
    await act(async () => {
      input.click()
      await Promise.resolve()
    })
    expect(sync.keepLocalCache).toBe(true)
    // Rolled back
    expect(input.checked).toBe(true)
    // Actual count preserved
    expect(host.textContent).toContain('2 cached channels')
    // Actionable error
    expect(host.textContent).toContain('Could not update cache preference. Changes were reverted.')
  })

  it('Fix 3: does not label ended broadcast as Current live when isLive is false', () => {
    const rows = mergePastVodRows(
      [],
      [{ streamId: 'ended', chatMessages: 10, endedAt: '2026-09-03T20:00:00Z' }],
      { isLive: false, liveStreamId: 'ended' },
    )
    expect(rows[0].analyticsStatus).toBe('synced')
    expect(rows.some(r => r.analyticsStatus === 'current-live')).toBe(false)
  })

  it('Fix 4: recap moment metrics agree with chart bucket rollup values', () => {
    const rollup = { offsetSeconds: 5160, chatCount: 689, totalEmoteCount: 617, viewerCount: 24433 }
    const metrics = resolveRecapMomentMetrics(
      { offsetSeconds: 5160, score: 100, reasons: ['emote_spike'], chatCount: 895, emoteCount: 769 },
      [rollup],
    )
    // Canonical agreement with chart bucket:
    expect(metrics.chatCount).toBe(rollup.chatCount)
    expect(metrics.emoteCount).toBe(rollup.totalEmoteCount)
    expect(metrics.viewerCount).toBe(rollup.viewerCount)
  })
})
