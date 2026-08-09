import { build as viteBuild, defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { getBuildProvenance, writeBuildProvenance } from './scripts/build-provenance.mjs'

const root = __dirname

const extensionInputScope = [
  'src',
  // The extension settings panel imports this canonical public manifest. Keep
  // it in the provenance scope so a changelog edit cannot leave a stale
  // unpacked extension claiming to be fresh.
  'streampulse-web/src/lib/release-notes.json',
  'public',
  'popup',
  'options',
  'manifest.json',
  'vite.config.ts',
  'scripts/build-provenance.mjs',
  'package.json',
  'package-lock.json',
]

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

function listFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function chromeExtensionPlugin() {
  return {
    name: 'streamclone-pulse-extension',
    buildStart() {
      // The content entry is compiled by the nested build below, so it is not
      // part of the outer Rollup graph. Register the source tree explicitly or
      // Vite build --watch will never receive content-only edits. Rollup does
      // not reliably watch a directory passed to addWatchFile, so enumerate
      // files instead.
      for (const path of listFiles(resolve(__dirname, 'src'))) this.addWatchFile(path)
    },
    async writeBundle() {
      // Rollup's closeBundle hook is only guaranteed when the watcher exits.
      // writeBundle runs after every watch cycle, so the nested content entry
      // cannot silently remain from an earlier source edit.
      await viteBuild({
        configFile: false,
        plugins: [react()],
        resolve: extensionResolve(),
        build: {
          // MV3 content script is a single IIFE with inlineDynamicImports — cannot code-split.
          // Limit sits above the current twitch.js size so future growth still warns.
          chunkSizeWarningLimit: 600,
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

      const dist = resolve(__dirname, 'dist')
      mkdirSync(dist, { recursive: true })
      const provenance = getBuildProvenance({
        repoRoot: root,
        repository: 'streamclone-pulse-extension',
        mode: process.env.PULSE_BUILD_MODE?.trim() || 'source',
        scope: extensionInputScope,
      })
      const manifest = JSON.parse(readFileSync(resolve(__dirname, 'manifest.json'), 'utf8'))
      // Chrome displays version_name on chrome://extensions, making it
      // possible to identify the loaded build without exposing paths or env.
      const manifestCommit = provenance.commit === 'unknown' ? 'unknown' : provenance.commit.slice(0, 8)
      const packageCohort = provenance.packageCohortFingerprint?.slice(0, 8) || 'unknown'
      manifest.version_name = `${manifest.version} (${manifestCommit}${provenance.dirty ? '-dirty' : ''}; cohort ${packageCohort})`
      writeFileSync(resolve(dist, 'manifest.json'), JSON.stringify(manifest, null, 2))
      for (const page of ['popup/index.html', 'options/index.html'] as const) {
        copyToDist(__dirname, page)
      }
      mkdirSync(resolve(dist, 'icons'), { recursive: true })
      for (const size of [16, 48, 128]) {
        copyFileSync(resolve(__dirname, `public/icons/icon${size}.png`), resolve(dist, `icons/icon${size}.png`))
      }
      writeBuildProvenance(
        dist,
        provenance,
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), chromeExtensionPlugin()],
  define: {
    __STREAMPULSE_BUILD_META__: JSON.stringify(getBuildProvenance({
      repoRoot: root,
      repository: 'streamclone-pulse-extension',
      mode: process.env.PULSE_BUILD_MODE?.trim() || 'source',
      scope: extensionInputScope,
    })),
  },
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
