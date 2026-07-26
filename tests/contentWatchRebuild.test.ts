import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { open, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const viteBin = resolve(repoRoot, 'node_modules/vite/bin/vite.js')
const node = process.execPath

async function hashFile(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function waitForFile(path: string, timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await stat(path)
      return
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    }
  }
  throw new Error(`timed out waiting for ${path}`)
}

async function waitForChange(
  path: string,
  previous: { mtimeMs: number; hash: string },
  timeoutMs = 45_000,
): Promise<{ mtimeMs: number; hash: string; content: Buffer }> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // Same file handle for fstat + read avoids TOCTOU between check and use.
    const fh = await open(path, 'r')
    try {
      const info = await fh.stat()
      const content = Buffer.from(await fh.readFile())
      const hash = createHash('sha256').update(content).digest('hex')
      if (info.mtimeMs > previous.mtimeMs && hash !== previous.hash) {
        return { mtimeMs: info.mtimeMs, hash, content }
      }
    } finally {
      await fh.close()
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
  }
  throw new Error(`timed out waiting for rebuild of ${path}`)
}

/**
 * Mirrors scripts/dev-extension-watch.mjs: parallel main + content Vite watches.
 * Uses an isolated temp project so real src/ is never mutated.
 */
function spawnDualWatch(tempRoot: string) {
  const children = [
    spawn(node, [viteBin, 'build', '--watch', '--config', 'vite.main.config.mjs'], {
      cwd: tempRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    }),
    spawn(node, [viteBin, 'build', '--watch', '--config', 'vite.content.config.mjs'], {
      cwd: tempRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    }),
  ]
  const shutdown = () => {
    for (const child of children) {
      if (!child.killed) child.kill('SIGTERM')
    }
  }
  return { children, shutdown }
}

describe('content watch rebuild', () => {
  it(
    'dual watcher rebuilds content IIFE on content-only dep edit (dev-extension-watch pattern)',
    async () => {
      const tempRoot = await mkdtemp(join(tmpdir(), 'pulse-dual-watch-'))
      const srcDir = join(tempRoot, 'src')
      const contentDir = join(srcDir, 'content')
      const mainDir = join(srcDir, 'main')
      const outDir = join(tempRoot, 'dist')
      const contentOut = join(outDir, 'content', 'bundle.js')
      const mainOut = join(outDir, 'main.js')
      const depPath = join(contentDir, 'dep.ts')
      let shutdown: (() => void) | undefined

      try {
        await mkdir(contentDir, { recursive: true })
        await mkdir(mainDir, { recursive: true })
        await writeFile(depPath, `export const marker = 'v1'\n`, 'utf8')
        await writeFile(
          join(contentDir, 'entry.ts'),
          `import { marker } from './dep.ts'\nconsole.log('content', marker)\n`,
          'utf8',
        )
        await writeFile(join(mainDir, 'entry.ts'), `console.log('main-shell')\n`, 'utf8')

        // Minimal Vite configs — content uses IIFE + inlineDynamicImports like vite.content.config.ts
        await writeFile(
          join(tempRoot, 'vite.main.config.mjs'),
          `import { defineConfig } from 'vite'
import { resolve } from 'node:path'
export default defineConfig({
  root: ${JSON.stringify(tempRoot)},
  logLevel: 'warn',
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    watch: {},
    rollupOptions: {
      input: resolve(${JSON.stringify(tempRoot)}, 'src/main/entry.ts'),
      output: { entryFileNames: 'main.js', format: 'es' },
    },
  },
})
`,
          'utf8',
        )
        await writeFile(
          join(tempRoot, 'vite.content.config.mjs'),
          `import { defineConfig } from 'vite'
import { resolve } from 'node:path'
export default defineConfig({
  root: ${JSON.stringify(tempRoot)},
  logLevel: 'warn',
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    watch: {},
    rollupOptions: {
      input: resolve(${JSON.stringify(tempRoot)}, 'src/content/entry.ts'),
      output: {
        entryFileNames: 'content/bundle.js',
        format: 'iife',
        inlineDynamicImports: true,
        name: 'TempContent',
      },
    },
  },
})
`,
          'utf8',
        )
        await writeFile(
          join(tempRoot, 'package.json'),
          JSON.stringify({ type: 'module', private: true }),
          'utf8',
        )
        // Resolve vite from the real repo install without mutating repo sources.
        await symlink(join(repoRoot, 'node_modules'), join(tempRoot, 'node_modules'), 'junction')

        const dual = spawnDualWatch(tempRoot)
        shutdown = dual.shutdown

        await waitForFile(contentOut)
        await waitForFile(mainOut)

        const initialContent = await stat(contentOut)
        const initialContentHash = await hashFile(contentOut)
        const initialMainHash = await hashFile(mainOut)

        // Content-only edit must rebuild content IIFE without requiring outer rebuild.
        await writeFile(depPath, `export const marker = 'v2'\n`, 'utf8')
        const changed = await waitForChange(contentOut, {
          mtimeMs: initialContent.mtimeMs,
          hash: initialContentHash,
        })

        const rebuilt = changed.content.toString('utf8')
        expect(rebuilt).toContain('v2')
        expect(rebuilt).not.toContain('v1')
        // IIFE constraints preserved
        expect(rebuilt).toMatch(/TempContent|!\s*function|\(function/)

        // Outer shell artifact remains available (dual watch still running).
        expect(await hashFile(mainOut)).toBe(initialMainHash)
        expect(await readFile(mainOut, 'utf8')).toContain('main-shell')
      } finally {
        shutdown?.()
        await new Promise((r) => setTimeout(r, 300))
        await rm(tempRoot, { recursive: true, force: true })
      }
    },
    90_000,
  )
})
