import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const webRoot = resolve(import.meta.dirname, '..')
const deploymentScript = readFileSync(resolve(webRoot, 'scripts/pages-deploy-prod.mjs'), 'utf8')

describe('Cloudflare Pages production deployment hygiene', () => {
  it('uses the pinned local Wrangler and protects production deploys', () => {
    expect(deploymentScript).toContain('ALLOW_DIRTY_PAGES_DEPLOY')
    expect(deploymentScript).toContain('node_modules/.bin/wrangler')
    expect(deploymentScript).not.toContain("['wrangler', ...deployArgs]")
  })

  it('ships Pages security and cache headers', () => {
    const headers = readFileSync(resolve(webRoot, 'public/_headers'), 'utf8')
    expect(headers).toContain('X-Content-Type-Options: nosniff')
    expect(headers).toContain('Content-Security-Policy-Report-Only:')
    expect(headers).toContain('/assets/*')
    expect(headers).toContain('Cache-Control: public, max-age=31536000, immutable')
  })
})
