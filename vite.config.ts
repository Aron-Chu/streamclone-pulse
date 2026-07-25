import { build as viteBuild, defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { loadManifestForTarget, resolveExtensionTarget } from './scripts/extension-target.mjs'
import { extensionResolve, isStoreBuild, sharedOutput } from './vite.shared.ts'

const root = __dirname
const extensionTarget = resolveExtensionTarget()

function copyToDist(rootDir: string, relativePath: string): void {
  const src = resolve(rootDir, relativePath)
  const dest = resolve(rootDir, 'dist', relativePath)
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
}

function chromeExtensionPlugin() {
  return {
    name: 'streamclone-pulse-extension',
    async closeBundle() {
      // One-shot builds: content IIFE via dedicated config (dev watch uses the same file).
      await viteBuild({ configFile: resolve(__dirname, 'vite.content.config.ts') })

      const dist = resolve(__dirname, 'dist')
      mkdirSync(dist, { recursive: true })
      const manifest = loadManifestForTarget(extensionTarget)
      writeFileSync(resolve(dist, 'manifest.json'), JSON.stringify(manifest, null, 2))
      writeFileSync(
        resolve(dist, 'extension-target.json'),
        JSON.stringify({ target: extensionTarget, version: manifest.version }, null, 2),
      )
      for (const page of ['popup/index.html', 'options/index.html'] as const) {
        copyToDist(__dirname, page)
      }
      mkdirSync(resolve(dist, 'icons'), { recursive: true })
      for (const size of [16, 48, 128]) {
        copyFileSync(resolve(__dirname, `public/icons/icon${size}.png`), resolve(dist, `icons/icon${size}.png`))
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), chromeExtensionPlugin()],
  resolve: extensionResolve(),
  define: {
    __EXTENSION_STORE_BUILD__: JSON.stringify(isStoreBuild),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'background/service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
        'popup/popup': resolve(__dirname, 'src/popup/popup.tsx'),
        'options/options': resolve(__dirname, 'src/options/options.tsx'),
      },
      output: sharedOutput,
    },
  },
})
