import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { firefoxDataCollectionErrors, readExportedBooleanFlag } from '../scripts/extension-permission-allowlists.mjs'
import { EXTENSION_ANALYTICS_INGEST_ENABLED } from '../src/shared/extensionAnalytics.ts'
import { EXTENSION_DIAGNOSTICS_INGEST_ENABLED } from '../src/shared/diagnosticsConsent.ts'

const required = ['browsingActivity', 'authenticationInfo', 'financialAndPaymentInfo']
const off = { required }
const on = { required, optional: ['technicalAndInteraction'] }

describe('Firefox package data collection gate', () => {
  it.each([
    [false, false, off],
    [true, false, on],
    [false, true, on],
    [true, true, on],
  ])('accepts the exact declaration for analytics=%s, diagnostics=%s', (analytics, diagnostics, declaration) => {
    expect(firefoxDataCollectionErrors(declaration, declaration, analytics, diagnostics)).toEqual([])
  })

  it('rejects a switch/permission mismatch in either source or built manifest', () => {
    expect(firefoxDataCollectionErrors(on, on, false, false)).not.toEqual([])
    expect(firefoxDataCollectionErrors(off, off, true, false)).not.toEqual([])
    expect(firefoxDataCollectionErrors(on, off, false, false)).not.toEqual([])
    expect(firefoxDataCollectionErrors(off, on, true, false)).not.toEqual([])
  })

  it.each([
    { required: [...required, 'technicalAndInteraction'] },
    { required, optional: ['technicalAndInteraction', 'websiteActivity'] },
    { required, optional: ['technicalAndInteraction', 'technicalAndInteraction'] },
    { required, optional: ['technicalAndInteraction'], other: true },
    null,
  ])('rejects unexpected declarations even when both manifests match', declaration => {
    expect(firefoxDataCollectionErrors(declaration, declaration, true, false)).not.toEqual([])
  })

  it('reads the actual source flags as literal booleans', () => {
    const analytics = readFileSync(new URL('../src/shared/extensionAnalytics.ts', import.meta.url), 'utf8')
    const diagnostics = readFileSync(new URL('../src/shared/diagnosticsConsent.ts', import.meta.url), 'utf8')
    expect(readExportedBooleanFlag(analytics, 'EXTENSION_ANALYTICS_INGEST_ENABLED')).toBe(EXTENSION_ANALYTICS_INGEST_ENABLED)
    expect(readExportedBooleanFlag(diagnostics, 'EXTENSION_DIAGNOSTICS_INGEST_ENABLED')).toBe(EXTENSION_DIAGNOSTICS_INGEST_ENABLED)
  })

  it.each([
    ['export const FLAG = false', false],
    ['export const FLAG = true', true],
  ])('reads a literal upload switch: %s', (source, value) => {
    expect(readExportedBooleanFlag(source, 'FLAG')).toBe(value)
  })

  it.each([
    'export let FLAG = false',
    'export declare const FLAG = false',
    'const FLAG = false',
    'export const FLAG = other',
    'export const FLAG = false as const',
    'export const FLAG = false; export const FLAG = true',
    'export const OTHER = false',
    'export const FLAG =',
  ])('fails closed when a switch cannot be verified: %s', source => {
    expect(() => readExportedBooleanFlag(source, 'FLAG')).toThrow()
  })
})
