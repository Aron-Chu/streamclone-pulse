import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extensionResolve, sharedOutput } from './vite.shared.ts'

const root = fileURLToPath(new URL('.', import.meta.url))

/**
 * content/moment-frames.js: the frames that give Top Moments rows and moment
 * cards a picture, built on its own so it never counts against the Twitch
 * content script's size budget. The worker injects it into a Twitch tab with
 * chrome.scripting when Pulse shows there and Moment pictures is on
 * (src/background/momentFramesScript.ts). Framework-free and self-contained:
 * one IIFE, no shared chunks.
 */
export default defineConfig({
  root,
  resolve: extensionResolve(),
  build: {
    minify: 'terser',
    terserOptions: {
      compress: { passes: 2, toplevel: true },
      mangle: { toplevel: true },
    },
    outDir: 'dist',
    emptyOutDir: false,
    copyPublicDir: false,
    rollupOptions: {
      input: resolve(root, 'src/content/momentFrames.ts'),
      output: {
        ...sharedOutput,
        entryFileNames: 'content/moment-frames.js',
        format: 'iife',
        inlineDynamicImports: true,
        name: 'StreamPulseMomentFrames',
      },
    },
  },
})
