import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveExtensionTarget } from './scripts/extension-target.mjs'

const root = fileURLToPath(new URL('.', import.meta.url))

export const extensionTarget = resolveExtensionTarget()
export const isStoreBuild = extensionTarget === 'cws' || extensionTarget === 'edge'

/** One React instance for overlay + @streampulse/pulse-charts (nested package react breaks hooks). */
export function extensionResolve() {
  return {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: resolve(root, 'node_modules/react'),
      'react-dom': resolve(root, 'node_modules/react-dom'),
    },
  }
}

export const sharedOutput = {
  entryFileNames: '[name].js',
  chunkFileNames: 'chunks/[name].js',
  assetFileNames: 'assets/[name][extname]',
}
