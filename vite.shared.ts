import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveExtensionTarget } from './scripts/extension-target.mjs'

const root = fileURLToPath(new URL('.', import.meta.url))

export const extensionTarget = resolveExtensionTarget()
export const isStoreBuild =
  extensionTarget === 'cws' || extensionTarget === 'edge' || extensionTarget === 'firefox'

/** One React instance for overlay + @streampulse/pulse-charts (nested package react breaks hooks). */
export function extensionResolve() {
  return {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: resolve(root, 'node_modules/react'),
      'react-dom': resolve(root, 'node_modules/react-dom'),
      // In-repo RPR-6 packages (src exports for Vite DX).
      // pulse-charts resolves to a curated extension surface so portal-only
      // chart machinery is never bundled into the content script.
      '@streampulse/pulse-core': resolve(root, 'packages/pulse-core/src/index.ts'),
      '@streampulse/pulse-charts': resolve(root, 'packages/pulse-charts/src/extension.ts'),
    },
  }
}

export const sharedOutput = {
  entryFileNames: '[name].js',
  chunkFileNames: 'chunks/[name].js',
  assetFileNames: 'assets/[name][extname]',
}
