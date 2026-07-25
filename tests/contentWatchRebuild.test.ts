import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'

async function hashFile(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function waitForFile(path: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await stat(path)
      return
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  throw new Error(`timed out waiting for ${path}`)
}

async function waitForBundleEnd(watcher: { on: (event: string, handler: (payload: unknown) => void) => void }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    watcher.on('event', (payload: unknown) => {
      const event = payload as { code?: string; error?: Error }
      if (event.code === 'BUNDLE_END') resolve()
      if (event.code === 'ERROR') reject(event.error ?? new Error('watch build failed'))
    })
  })
}

async function waitForChange(
  path: string,
  previous: { mtimeMs: number; hash: string },
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const info = await stat(path)
    const hash = await hashFile(path)
    if (info.mtimeMs > previous.mtimeMs && hash !== previous.hash) return
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error(`timed out waiting for rebuild of ${path}`)
}

describe('content watch rebuild', () => {
  it(
    'rebuilds content output when a dependency file changes',
    async () => {
      const tempRoot = await mkdtemp(join(tmpdir(), 'pulse-content-watch-'))
      const srcDir = join(tempRoot, 'src')
      const outDir = join(tempRoot, 'dist')
      const entryPath = join(srcDir, 'entry.ts')
      const depPath = join(srcDir, 'dep.ts')
      const outputPath = join(outDir, 'content', 'bundle.js')
      let watcher: Awaited<ReturnType<typeof build>> | undefined

      try {
        await mkdir(srcDir, { recursive: true })
        await writeFile(depPath, `export const marker = 'v1'\n`, 'utf8')
        await writeFile(
          entryPath,
          `import { marker } from './dep.ts'\nconsole.log(marker)\n`,
          'utf8',
        )

        watcher = await build({
          root: tempRoot,
          configFile: false,
          logLevel: 'warn',
          build: {
            outDir,
            emptyOutDir: true,
            watch: {},
            rollupOptions: {
              input: entryPath,
              output: {
                entryFileNames: 'content/bundle.js',
                format: 'iife',
                inlineDynamicImports: true,
                name: 'TempContent',
              },
            },
          },
        })

        if (!watcher || !('on' in watcher)) {
          throw new Error('expected vite watch build to return a watcher')
        }

        await waitForBundleEnd(watcher)
        await waitForFile(outputPath)

        const initialStat = await stat(outputPath)
        const initialHash = await hashFile(outputPath)

        await writeFile(depPath, `export const marker = 'v2'\n`, 'utf8')
        await waitForChange(outputPath, { mtimeMs: initialStat.mtimeMs, hash: initialHash })

        const rebuilt = await readFile(outputPath, 'utf8')
        expect(rebuilt).toContain('v2')
        expect(rebuilt).not.toContain('v1')
      } finally {
        if (watcher && 'close' in watcher) {
          await watcher.close()
        }
        await rm(tempRoot, { recursive: true, force: true })
      }
    },
    60_000,
  )
})
