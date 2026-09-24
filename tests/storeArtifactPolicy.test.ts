import { describe, expect, it } from 'vitest'
import { findStoreDeveloperMarkers } from '../scripts/store-artifact-policy.mjs'

describe('store artifact developer-tool policy', () => {
  it('catches markers in generated chunks, not only the options entry', () => {
    expect(findStoreDeveloperMarkers('chunk code data-developer-tools')).toEqual(['data-developer-tools'])
    expect(findStoreDeveloperMarkers('safe shared settings bundle')).toEqual([])
  })
})
