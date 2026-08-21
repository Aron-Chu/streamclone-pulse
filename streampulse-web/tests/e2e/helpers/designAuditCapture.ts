import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Page, TestInfo } from '@playwright/test'

export type DesignAuditPhase = 'loading' | 'ready' | 'empty' | 'stale' | 'error'
export type DesignAuditInteraction =
  | 'fold'
  | 'full'
  | 'selected-moment'
  | 'chart-preview'
  | 'search-open'
  | 'drawer-open'
  | 'hover'
  | 'pin'
  | 'zoom'
  | 'none'

export type DesignAuditCaptureMeta = {
  timestamp: string
  viewport: { width: number; height: number }
  deviceScaleFactor: number
  prefersReducedMotion: boolean
  phase: DesignAuditPhase
  fixture: string
  interaction: DesignAuditInteraction
  browser: { name: string; version: string }
  git: { headShort: string; dirty: boolean }
  buildIdentity: string | null
  url: string
  firstPaintHubRequests?: string[]
}

let gitCache: { headShort: string; dirty: boolean } | null = null

export function readGitCaptureIdentity(repoRoot = path.resolve(process.cwd(), '..')): {
  headShort: string
  dirty: boolean
} {
  if (gitCache) return gitCache
  try {
    const headShort = execSync('git rev-parse --short HEAD', {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim()
    const status = execSync('git status --short', {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    gitCache = { headShort, dirty: status.trim().length > 0 }
  } catch {
    gitCache = { headShort: 'unknown', dirty: true }
  }
  return gitCache
}

export async function collectCaptureMeta(
  page: Page,
  opts: {
    phase: DesignAuditPhase
    fixture: string
    interaction?: DesignAuditInteraction
    firstPaintHubRequests?: string[]
  },
): Promise<DesignAuditCaptureMeta> {
  const viewport = page.viewportSize() ?? { width: 0, height: 0 }
  const browser = page.context().browser()
  const prefersReducedMotion = await page.evaluate(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const deviceScaleFactor = await page.evaluate(() => window.devicePixelRatio || 1)
  const buildIdentity = await page.evaluate(() => {
    const meta = document.querySelector('meta[name="sp-build"], meta[name="build-id"]')
    return meta?.getAttribute('content') ?? null
  })
  const git = readGitCaptureIdentity()
  return {
    timestamp: new Date().toISOString(),
    viewport,
    deviceScaleFactor,
    prefersReducedMotion,
    phase: opts.phase,
    fixture: opts.fixture,
    interaction: opts.interaction ?? 'none',
    browser: {
      name: browser?.browserType().name() ?? 'unknown',
      version: browser?.version() ?? 'unknown',
    },
    git,
    buildIdentity,
    url: page.url(),
    firstPaintHubRequests: opts.firstPaintHubRequests,
  }
}

export async function writeCaptureArtifact(
  page: Page,
  outDir: string,
  basename: string,
  opts: {
    phase: DesignAuditPhase
    fixture: string
    interaction?: DesignAuditInteraction
    fullPage?: boolean
    firstPaintHubRequests?: string[]
    extra?: Record<string, unknown>
  },
): Promise<DesignAuditCaptureMeta> {
  fs.mkdirSync(outDir, { recursive: true })
  const meta = await collectCaptureMeta(page, opts)
  await page.screenshot({
    path: path.join(outDir, `${basename}.png`),
    fullPage: opts.fullPage ?? false,
  })
  fs.writeFileSync(
    path.join(outDir, `${basename}.meta.json`),
    `${JSON.stringify({ ...meta, ...(opts.extra ?? {}) }, null, 2)}\n`,
    'utf8',
  )
  return meta
}

function sanitizePathSegment(value: string): string {
  return value
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
    .replace(/[→←↔⇒⇐]/gu, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80)
}

export function auditOutputDir(testInfo: TestInfo, leaf: string): string {
  const dir = testInfo.outputPath(leaf)
  fs.mkdirSync(dir, { recursive: true })
  const mirrorRoot = process.env.AUDIT_EVIDENCE_DIR?.trim()
  if (mirrorRoot) {
    const title = testInfo.titlePath.map(sanitizePathSegment).join('__')
    const mirror = path.join(mirrorRoot, title, sanitizePathSegment(leaf))
    fs.mkdirSync(mirror, { recursive: true })
    return mirror
  }
  return dir
}

/** Track hub API requests until first paint screenshot is taken. */
export function attachHubRequestTracker(page: Page): string[] {
  const hits: string[] = []
  page.on('request', (req) => {
    try {
      const u = new URL(req.url())
      if (u.pathname === '/v1/public/hub' || u.pathname.startsWith('/v1/public/hub/')) {
        hits.push(`${req.method()} ${u.pathname}${u.search}`)
      }
    } catch {
      /* ignore */
    }
  })
  return hits
}

export async function setReducedMotion(page: Page, reduce: boolean): Promise<void> {
  await page.emulateMedia({ reducedMotion: reduce ? 'reduce' : 'no-preference' })
}
