import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- plain .mjs deploy helper without type declarations
import { REQUIRED_PRODUCTION_INPUTS, checkProductionBuildEnv, describeWaivedInputs } from '../scripts/pages-deploy-env.mjs'
import { parseDiscordInviteUrl } from '../src/lib/discord'

type Input = { name: string; optOut: string; valid: (value: string) => boolean }
const inputs = REQUIRED_PRODUCTION_INPUTS as Input[]
const webRoot = resolve(import.meta.dirname, '..')

// Well-formed placeholders: none of these is a real credential.
const complete = {
  VITE_SENTRY_DSN: 'https://publickey@o1.ingest.us.sentry.io/123',
  SENTRY_AUTH_TOKEN: 'placeholder',
  VITE_POSTHOG_PROJECT_TOKEN: 'phc_placeholder123',
  VITE_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  VITE_PUBLIC_DISCORD_INVITE_URL: 'https://discord.gg/placeholder',
}

describe('production deploy build inputs', () => {
  it('guards the Sentry, PostHog, Turnstile and Discord names, each with its own waiver', () => {
    expect(inputs.map((input) => input.name)).toEqual([
      'VITE_SENTRY_DSN', 'VITE_POSTHOG_PROJECT_TOKEN', 'VITE_TURNSTILE_SITE_KEY', 'VITE_PUBLIC_DISCORD_INVITE_URL',
    ])
    expect(inputs.map((input) => input.optOut)).toEqual([
      'PAGES_DEPLOY_ALLOW_NO_SENTRY', 'PAGES_DEPLOY_ALLOW_NO_POSTHOG', 'PAGES_DEPLOY_ALLOW_NO_TURNSTILE', 'PAGES_DEPLOY_ALLOW_NO_DISCORD',
    ])
  })

  it('passes a complete environment', () => {
    expect(checkProductionBuildEnv(complete)).toEqual({ errors: [], waived: [] })
  })

  it('refuses a fresh shell and names every missing input without printing values', () => {
    const { errors, waived } = checkProductionBuildEnv({})
    expect(waived).toEqual([])
    expect(errors).toHaveLength(4)
    for (const input of inputs) expect(errors.join('\n')).toContain(`${input.name} is not set`)
    for (const input of inputs) expect(errors.join('\n')).toContain(`${input.optOut}=1`)
  })

  it.each(inputs.map((input) => [input.name, input.optOut]))('refuses when only %s is missing', (name) => {
    const { errors } = checkProductionBuildEnv({ ...complete, [name]: '   ' })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(`${name} is not set`)
  })

  it('treats a malformed value as missing, because the app would drop it', () => {
    const malformed = {
      VITE_SENTRY_DSN: 'not-a-dsn-secret-value',
      VITE_POSTHOG_PROJECT_TOKEN: 'token-secret-value',
      VITE_TURNSTILE_SITE_KEY: 'bad key secret value',
      VITE_PUBLIC_DISCORD_INVITE_URL: 'https://discord.gg/abc?secret-value',
    }
    const { errors } = checkProductionBuildEnv({ ...complete, ...malformed })
    expect(errors).toHaveLength(4)
    for (const value of Object.values(malformed)) expect(errors.join('\n')).not.toContain(value)
    expect(errors.join('\n')).not.toContain('placeholder')
  })

  it('allows an explicit waiver of exactly 1 and announces it loudly', () => {
    const { errors, waived } = checkProductionBuildEnv({
      ...complete, VITE_TURNSTILE_SITE_KEY: '', PAGES_DEPLOY_ALLOW_NO_TURNSTILE: '1',
    })
    expect(errors).toEqual([])
    expect((waived as Input[]).map((input) => input.name)).toEqual(['VITE_TURNSTILE_SITE_KEY'])
    const banner = describeWaivedInputs(waived).join('\n')
    expect(banner).toContain('WITHOUT 1 production input')
    expect(banner).toContain('VITE_TURNSTILE_SITE_KEY waived by PAGES_DEPLOY_ALLOW_NO_TURNSTILE=1')
    expect(describeWaivedInputs([])).toEqual([])
  })

  it('rejects ambiguous waivers', () => {
    expect(checkProductionBuildEnv({ ...complete, VITE_SENTRY_DSN: '', PAGES_DEPLOY_ALLOW_NO_SENTRY: 'true' }).errors)
      .toEqual(['PAGES_DEPLOY_ALLOW_NO_SENTRY must be exactly 1 to waive VITE_SENTRY_DSN'])
    expect(checkProductionBuildEnv({ ...complete, PAGES_DEPLOY_ALLOW_NO_DISCORD: '1' }).errors[0])
      .toContain('PAGES_DEPLOY_ALLOW_NO_DISCORD=1 is set while VITE_PUBLIC_DISCORD_INVITE_URL is also set')
  })

  it('still requires the Sentry auth token for source maps when a DSN is set', () => {
    expect(checkProductionBuildEnv({ ...complete, SENTRY_AUTH_TOKEN: '' }).errors[0]).toContain('SENTRY_AUTH_TOKEN is missing')
    expect(checkProductionBuildEnv({ ...complete, VITE_SENTRY_DSN: '', SENTRY_AUTH_TOKEN: '', PAGES_DEPLOY_ALLOW_NO_SENTRY: '1' }).errors).toEqual([])
  })

  it('accepts exactly the Discord invites the site itself accepts', () => {
    const discord = inputs.find((input) => input.name === 'VITE_PUBLIC_DISCORD_INVITE_URL')!
    for (const value of [
      'https://discord.gg/abc-123', 'https://discord.com/invite/Abc123', 'http://discord.gg/abc',
      'https://discord.gg/abc/', 'https://discord.gg/abc?x=1', 'https://discord.gg/abc#x', 'https://evil.example/abc',
      'https://discord.com/abc', 'https://discord.gg/a', 'https://discord.gg:443/abc',
    ]) {
      expect(discord.valid(value), value).toBe(parseDiscordInviteUrl(value) !== null)
    }
  })

  it('runs the guard before any build, test or upload step', () => {
    const script = readFileSync(resolve(webRoot, 'scripts/pages-deploy-prod.mjs'), 'utf8')
    const guard = script.indexOf('checkProductionBuildEnv(productionEnv)')
    expect(guard).toBeGreaterThan(0)
    for (const step of ["console.log('Running production deploy gates')", "run('npx', ['vite', 'build']", 'run(localWrangler, deployArgs)']) {
      expect(script.indexOf(step), step).toBeGreaterThan(guard)
    }
    expect(script).toContain("loadEnv('production', webRoot, ['VITE_'])")
  })

  it('exits before building when the deploy runs from a fresh shell', () => {
    // Empty values override any local .env.production file (Vite gives the shell
    // precedence), so this can never reach a build or an upload.
    const env: Record<string, string> = { ...process.env } as Record<string, string>
    for (const input of inputs) {
      env[input.name] = ''
      delete env[input.optOut]
    }
    env.VITE_BACKEND_URL = 'https://api.streampulse.stream'
    env.CLOUDFLARE_API_TOKEN = ''
    env.SENTRY_AUTH_TOKEN = ''
    const result = spawnSync(process.execPath, ['scripts/pages-deploy-prod.mjs'], { cwd: webRoot, env, encoding: 'utf8', timeout: 60_000 })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('refuses to build production without its build inputs')
    for (const input of inputs) expect(result.stderr).toContain(input.name)
    expect(result.stdout).not.toContain('Running production deploy gates')
    expect(result.stdout).not.toContain('Deploying git SHA')
  })
})
