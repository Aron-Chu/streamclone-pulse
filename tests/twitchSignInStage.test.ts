import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SIGN_IN_PUBLIC_TARGETS } from '../scripts/extension-permission-allowlists.mjs'
import { manifestForTwitchSignInStage, resolveTwitchSignInStage } from '../scripts/extension-target.mjs'
import { TWITCH_SIGNIN_ENABLED, TWITCH_SIGNIN_STAGE, parseTwitchSignInStage } from '../src/shared/twitchSignIn.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = (name: string) => JSON.parse(readFileSync(join(root, 'manifests', `${name}.json`), 'utf8')) as { permissions: string[] }

describe('Sign in with Twitch build stage (PULSE_EXTENSION_TWITCH_SIGNIN)', () => {
  it('is off by default, in tests and in every unset build', () => {
    expect(TWITCH_SIGNIN_STAGE).toBe('off')
    expect(TWITCH_SIGNIN_ENABLED).toBe(false)
    for (const target of ['development', 'cws', 'edge', 'firefox']) {
      // Store builds follow their manifest: identity (a store that ships sign-in) means public.
      const expected = SIGN_IN_PUBLIC_TARGETS.includes(target) ? 'public' : 'off'
      expect(resolveTwitchSignInStage(target, undefined)).toBe(expected)
      expect(resolveTwitchSignInStage(target, '')).toBe(expected)
      if (expected === 'off') expect(resolveTwitchSignInStage(target, 'off')).toBe('off')
      else expect(() => resolveTwitchSignInStage(target, 'off')).toThrow(/disagrees with the .* manifest/)
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
      expect(manifest(target).permissions.includes('identity')).toBe(SIGN_IN_PUBLIC_TARGETS.includes(target))
      expect(() => resolveTwitchSignInStage(target, 'public', { permissions: ['storage', 'scripting'] })).toThrow(/needs the .* manifest to request identity first/)
      expect(resolveTwitchSignInStage(target, 'public', { permissions: ['storage', 'scripting', 'identity'] })).toBe('public')
    }
  })

  it('derives a store build’s stage from its manifest, so the manifest is the one switch per store', () => {
    const withIdentity = { permissions: ['storage', 'scripting', 'identity'] }
    const without = { permissions: ['storage', 'scripting'] }
    for (const target of ['cws', 'edge', 'firefox']) {
      // No env needed: identity requested means public, none means off.
      expect(resolveTwitchSignInStage(target, undefined, withIdentity)).toBe('public')
      expect(resolveTwitchSignInStage(target, '', without)).toBe('off')
      // An env value may be given, but it must agree.
      expect(resolveTwitchSignInStage(target, 'public', withIdentity)).toBe('public')
      expect(resolveTwitchSignInStage(target, 'off', without)).toBe('off')
      // identity without sign-in is an unused permission, which store review rejects.
      expect(() => resolveTwitchSignInStage(target, 'off', withIdentity)).toThrow(/disagrees with the .* manifest, which requests identity/)
      expect(() => resolveTwitchSignInStage(target, 'tester', withIdentity)).toThrow(/development and preview builds only/)
    }
    // Development builds still read the env (default off); their checked-in manifest never requests identity.
    expect(resolveTwitchSignInStage('development', undefined, withIdentity)).toBe('off')
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
