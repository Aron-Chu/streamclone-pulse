import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { manifestForTwitchSignInStage, resolveTwitchSignInStage } from '../scripts/extension-target.mjs'
import { TWITCH_SIGNIN_ENABLED, TWITCH_SIGNIN_STAGE, parseTwitchSignInStage } from '../src/shared/twitchSignIn.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = (name: string) => JSON.parse(readFileSync(join(root, 'manifests', `${name}.json`), 'utf8')) as { permissions: string[] }

describe('Sign in with Twitch build stage (PULSE_EXTENSION_TWITCH_SIGNIN)', () => {
  it('is off by default, in tests and in every unset build', () => {
    expect(TWITCH_SIGNIN_STAGE).toBe('off')
    expect(TWITCH_SIGNIN_ENABLED).toBe(false)
    for (const target of ['development', 'cws', 'edge', 'firefox']) {
      expect(resolveTwitchSignInStage(target, undefined)).toBe('off')
      expect(resolveTwitchSignInStage(target, '')).toBe('off')
      expect(resolveTwitchSignInStage(target, 'off')).toBe('off')
    }
    expect(parseTwitchSignInStage('anything')).toBe('off')
  })

  it('accepts tester and public for development builds', () => {
    expect(resolveTwitchSignInStage('development', 'tester')).toBe('tester')
    expect(resolveTwitchSignInStage('development', ' PUBLIC ')).toBe('public')
  })

  it('rejects unknown values instead of guessing', () => {
    expect(() => resolveTwitchSignInStage('development', 'on')).toThrow(/unknown PULSE_EXTENSION_TWITCH_SIGNIN/)
    expect(() => resolveTwitchSignInStage('development', '1')).toThrow(/expected one of off, tester, public/)
  })

  it('refuses tester in every store build', () => {
    for (const target of ['cws', 'edge', 'firefox']) {
      expect(() => resolveTwitchSignInStage(target, 'tester')).toThrow(/development and preview builds only/)
    }
  })

  it('refuses public in a store build until that store manifest requests identity (spec E3)', () => {
    for (const target of ['cws', 'edge', 'firefox']) {
      expect(manifest(target).permissions).not.toContain('identity')
      expect(() => resolveTwitchSignInStage(target, 'public')).toThrow(/needs the .* manifest to request identity first/)
      expect(resolveTwitchSignInStage(target, 'public', { permissions: ['storage', 'scripting', 'identity'] })).toBe('public')
    }
  })

  it('adds identity to the generated development manifest only when Twitch is on, never identity.email', () => {
    const development = manifest('development')
    expect(manifestForTwitchSignInStage(development, 'development', 'off')).toBe(development)
    for (const stage of ['tester', 'public']) {
      const generated = manifestForTwitchSignInStage(development, 'development', stage)
      expect(generated.permissions).toEqual([...development.permissions, 'identity'])
      expect(generated.permissions).not.toContain('identity.email')
      // The checked-in manifest is untouched.
      expect(development.permissions).not.toContain('identity')
    }
    // Store manifests are never rewritten at build time.
    const cws = manifest('cws')
    expect(manifestForTwitchSignInStage(cws, 'cws', 'public')).toBe(cws)
  })
})
