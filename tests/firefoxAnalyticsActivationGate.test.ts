import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EXTENSION_ANALYTICS_INGEST_ENABLED } from '../src/shared/extensionAnalytics.ts'
import { EXTENSION_DIAGNOSTICS_INGEST_ENABLED } from '../src/shared/diagnosticsConsent.ts'
import { FIREFOX_TECHNICAL_DATA_PERMISSION } from '../src/shared/firefoxDataConsent.ts'

describe('Firefox technical-data activation gate', () => {
  it('declares the optional technical-data permission exactly when an upload is enabled', () => {
    const manifest = JSON.parse(readFileSync(new URL('../manifests/firefox.json', import.meta.url), 'utf8'))
    const data = manifest.browser_specific_settings?.gecko?.data_collection_permissions
    const declared = Array.isArray(data?.optional) && data.optional.includes(FIREFOX_TECHNICAL_DATA_PERMISSION)
    expect(data?.required ?? []).not.toContain(FIREFOX_TECHNICAL_DATA_PERMISSION)
    expect(declared).toBe(EXTENSION_ANALYTICS_INGEST_ENABLED || EXTENSION_DIAGNOSTICS_INGEST_ENABLED)
  })
})
