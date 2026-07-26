import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DIAGNOSTICS_CONSENT_SCHEMA_VERSION,
  DIAGNOSTICS_CONSENT_STORAGE,
  EXTENSION_DIAGNOSTICS_INGEST_ENABLED,
  isDiagnosticsConsentEnabled,
  parseDiagnosticsConsent,
  sanitizeDiagnosticsFrames,
  sanitizeExtensionDiagnosticReport,
  setDiagnosticsConsentEnabled,
} from '../src/shared/diagnosticsConsent.ts'
import {
  buildTrustedDiagnosticPayload,
  classifyDiagnosticsError,
  clearPendingDiagnosticsWork,
  deriveDiagnosticsSurface,
  emitExtensionDiagnostic,
  framesFromErrorStack,
  isAllowlistedDiagnosticsBundle,
  isTrustedDiagnosticsSender,
  pendingDiagnosticsWorkCount,
  trackDiagnosticsWork,
  trustedDiagnosticsBuildMeta,
} from '../src/shared/extensionDiagnostics.ts'

describe('diagnosticsConsent versioning', () => {
  const store = new Map<string, unknown>()

  beforeEach(() => {
    store.clear()
    clearPendingDiagnosticsWork()
  })

  const local = {
    get: vi.fn(async (key: string) => ({ [key]: store.get(key) })),
    set: vi.fn(async (bag: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(bag)) store.set(k, v)
    }),
    remove: vi.fn(async (key: string) => {
      store.delete(key)
    }),
  }

  it('treats missing and malformed records as off', async () => {
    expect(parseDiagnosticsConsent(undefined)).toBeNull()
    expect(parseDiagnosticsConsent({ schemaVersion: 99, enabled: true, updatedAt: 1 })).toBeNull()
    expect(parseDiagnosticsConsent({ schemaVersion: 1, enabled: 'yes', updatedAt: 1 })).toBeNull()
    expect(await isDiagnosticsConsentEnabled(local)).toBe(false)
  })

  it('handles storage get failure as off', async () => {
    const failing = {
      get: vi.fn(async () => {
        throw new Error('storage down')
      }),
    }
    expect(await isDiagnosticsConsentEnabled(failing as never)).toBe(false)
  })

  it('persists enabled consent and clears pending work on withdraw', async () => {
    const work = trackDiagnosticsWork()
    expect(pendingDiagnosticsWorkCount()).toBe(1)
    await setDiagnosticsConsentEnabled(true, local)
    expect(store.get(DIAGNOSTICS_CONSENT_STORAGE)).toMatchObject({
      schemaVersion: DIAGNOSTICS_CONSENT_SCHEMA_VERSION,
      enabled: true,
    })
    expect(await isDiagnosticsConsentEnabled(local)).toBe(true)

    await setDiagnosticsConsentEnabled(false, local)
    expect(store.has(DIAGNOSTICS_CONSENT_STORAGE)).toBe(false)
    expect(await isDiagnosticsConsentEnabled(local)).toBe(false)
    expect(work.signal.aborted).toBe(true)
    expect(pendingDiagnosticsWorkCount()).toBe(0)
  })
})

describe('diagnostics frame sanitizer', () => {
  it('keeps allowlisted bundles only and caps at 20', () => {
    const frames = sanitizeDiagnosticsFrames([
      { bundle: 'content/twitch.js', line: 1, column: 2 },
      { bundle: 'chunks/foo.js', line: 3, column: 4 },
      { bundle: '../etc/passwd', line: 1, column: 1 },
      { bundle: 'https://evil.example/x.js', line: 1, column: 1 },
      { bundle: 'evil/payload.js', line: 1, column: 1 },
      ...Array.from({ length: 25 }, (_, i) => ({
        bundle: 'background/service-worker.js',
        line: i,
        column: 0,
      })),
    ])
    expect(frames[0]).toEqual({ bundle: 'content/twitch.js', line: 1, column: 2 })
    expect(frames[1]).toEqual({ bundle: 'chunks/foo.js', line: 3, column: 4 })
    expect(frames).toHaveLength(20)
    expect(
      frames.every(
        f =>
          f.bundle === 'content/twitch.js' ||
          f.bundle === 'chunks/foo.js' ||
          f.bundle === 'background/service-worker.js',
      ),
    ).toBe(true)
  })

  it('rejects unknown bundles and extracts only allowlisted stack frames', () => {
    expect(isAllowlistedDiagnosticsBundle('evil/payload.js')).toBe(false)
    expect(isAllowlistedDiagnosticsBundle('content/twitch.js')).toBe(true)
    const stack = [
      'Error: boom',
      '    at foo (chrome-extension://abc/content/twitch.js:10:4)',
      '    at bar (https://twitch.tv/xqc:1:1)',
      '    at baz (chrome-extension://abc/evil/payload.js:2:2)',
      '    at qux (chrome-extension://abc/chunks/overlay.js:3:5)',
    ].join('\n')
    expect(framesFromErrorStack(stack)).toEqual([
      { bundle: 'content/twitch.js', line: 10, column: 4 },
      { bundle: 'chunks/overlay.js', line: 3, column: 5 },
    ])
  })

  it('sanitizes full reports and drops free-text fields', () => {
    const ok = sanitizeExtensionDiagnosticReport({
      schema_version: 1,
      release: 'streamclone-pulse@0.1.0',
      manifest_version: 3,
      target: 'development',
      surface: 'background',
      feature: 'service_worker',
      event: 'uncaught_error',
      error: 'unknown',
      frames: [{ bundle: 'popup/popup.js', line: 9, column: 1 }],
      message: 'should be ignored by schema',
    })
    expect(ok).toEqual({
      schema_version: 1,
      release: 'streamclone-pulse@0.1.0',
      manifest_version: 3,
      target: 'development',
      surface: 'background',
      feature: 'service_worker',
      event: 'uncaught_error',
      error: 'unknown',
      status: 'reported',
      frames: [{ bundle: 'popup/popup.js', line: 9, column: 1 }],
    })
    expect(sanitizeExtensionDiagnosticReport({ schema_version: 1, target: 'development' })).toBeNull()
  })
})

describe('trusted sender / surface / build meta', () => {
  const runtimeId = 'ext-runtime-id'

  it('validates sender.id and extension/content origins for every surface', () => {
    expect(
      isTrustedDiagnosticsSender(
        { id: runtimeId, url: `chrome-extension://${runtimeId}/popup/index.html` },
        { runtimeId },
      ),
    ).toBe(true)
    expect(
      isTrustedDiagnosticsSender(
        { id: runtimeId, url: `chrome-extension://${runtimeId}/options/index.html` },
        { runtimeId },
      ),
    ).toBe(true)
    expect(
      isTrustedDiagnosticsSender(
        { id: runtimeId, url: `chrome-extension://${runtimeId}/background/service-worker.js` },
        { runtimeId },
      ),
    ).toBe(true)
    expect(
      isTrustedDiagnosticsSender(
        { id: runtimeId, tab: { id: 1 }, url: 'https://www.twitch.tv/xqc' },
        { runtimeId },
      ),
    ).toBe(true)
    expect(
      isTrustedDiagnosticsSender(
        { id: 'other', tab: { id: 1 }, url: 'https://www.twitch.tv/xqc' },
        { runtimeId },
      ),
    ).toBe(false)
    expect(
      isTrustedDiagnosticsSender(
        { id: runtimeId, tab: { id: 1 }, url: 'https://evil.example/' },
        { runtimeId },
      ),
    ).toBe(false)
  })

  it('derives surface from sender URL/tab — ignores payload surface', () => {
    expect(
      deriveDiagnosticsSurface({
        id: runtimeId,
        url: `chrome-extension://${runtimeId}/popup/index.html`,
      }),
    ).toBe('popup')
    expect(
      deriveDiagnosticsSurface({
        id: runtimeId,
        url: `chrome-extension://${runtimeId}/options/index.html`,
      }),
    ).toBe('options')
    expect(
      deriveDiagnosticsSurface({
        id: runtimeId,
        url: `chrome-extension://${runtimeId}/background/service-worker.js`,
      }),
    ).toBe('background')
    expect(
      deriveDiagnosticsSurface({
        id: runtimeId,
        tab: { id: 9 },
        url: 'https://www.twitch.tv/xqc',
      }),
    ).toBe('content')
  })

  it('derives release/target/manifest from trusted build state', () => {
    const meta = trustedDiagnosticsBuildMeta({
      getManifest: () => ({ version: '0.1.0', manifest_version: 3 }) as chrome.runtime.Manifest,
      extensionTarget: 'cws',
    })
    expect(meta).toEqual({
      release: 'streamclone-pulse@0.1.0',
      manifest_version: 3,
      target: 'cws',
    })
    const payload = buildTrustedDiagnosticPayload({
      feature: 'overlay',
      event: 'render_error',
      error: 'type_error',
      frames: [{ bundle: 'content/twitch.js', line: 1, column: 1 }],
      surface: 'content',
      build: meta,
    })
    expect(payload.release).toBe('streamclone-pulse@0.1.0')
    expect(payload.target).toBe('cws')
    expect(payload.surface).toBe('content')
    expect(JSON.stringify(payload)).not.toContain('user@example.com')
  })
})

describe('error classification + zero transmission while disabled', () => {
  afterEach(() => {
    clearPendingDiagnosticsWork()
  })

  it('maps exceptions to fixed error enums without using message text in payload', () => {
    expect(classifyDiagnosticsError(new TypeError('user@example.com https://twitch.tv/xqc'))).toBe(
      'type_error',
    )
    expect(classifyDiagnosticsError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(
      'abort',
    )
    expect(classifyDiagnosticsError(new Error('extension_api_timeout'))).toBe('timeout')
    expect(classifyDiagnosticsError(new TypeError('Failed to fetch'))).toBe('type_error')
  })

  it('emits nothing while EXTENSION_DIAGNOSTICS_INGEST_ENABLED is false', async () => {
    expect(EXTENSION_DIAGNOSTICS_INGEST_ENABLED).toBe(false)
    const send = vi.fn(async () => ({ ok: true }))
    await emitExtensionDiagnostic({
      feature: 'overlay',
      event: 'uncaught_error',
      error: 'unknown',
      frames: [{ bundle: 'content/twitch.js', line: 1, column: 1 }],
      send,
    })
    expect(send).not.toHaveBeenCalled()
  })
})
