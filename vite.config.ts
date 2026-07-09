import { build as viteBuild, defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const root = __dirname

/** One React instance for overlay + @streampulse/pulse-charts (nested package react breaks hooks). */
function extensionResolve() {
  return {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: resolve(root, 'node_modules/react'),
      'react-dom': resolve(root, 'node_modules/react-dom'),
    },
  }
}

const sharedOutput = {
  entryFileNames: '[name].js',
  chunkFileNames: 'chunks/[name].js',
  assetFileNames: 'assets/[name][extname]',
}

function copyToDist(root: string, relativePath: string): void {
  const src = resolve(root, relativePath)
  const dest = resolve(root, 'dist', relativePath)
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
}

function chromeExtensionPlugin() {
  let contentBuildComplete = false

  return {
    name: 'streamclone-pulse-extension',
    async closeBundle() {
      if (!contentBuildComplete) {
        contentBuildComplete = true
        await viteBuild({
          configFile: false,
          plugins: [react()],
          resolve: extensionResolve(),
          build: {
            outDir: 'dist',
            emptyOutDir: false,
            rollupOptions: {
              input: resolve(__dirname, 'src/content/entry.ts'),
              output: {
                ...sharedOutput,
                entryFileNames: 'content/twitch.js',
                format: 'iife',
                inlineDynamicImports: true,
                name: 'StreamclonePulseContent',
              },
            },
          },
        })
      }

      const dist = resolve(__dirname, 'dist')
      mkdirSync(dist, { recursive: true })
      const manifest = JSON.parse(readFileSync(resolve(__dirname, 'manifest.json'), 'utf8'))
      writeFileSync(resolve(dist, 'manifest.json'), JSON.stringify(manifest, null, 2))
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
