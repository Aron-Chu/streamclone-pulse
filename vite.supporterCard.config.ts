import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extensionResolve, sharedOutput } from './vite.shared.ts'

const root = fileURLToPath(new URL('.', import.meta.url))

/**
 * content/supporter-card.js: the quick-settings Supporter card's stage (the
 * design lab's "Your Line"), built on its own so it never counts against the
 * Twitch content script's size budget. The worker injects it into a Twitch tab
 * with chrome.scripting only when the card is shown (src/background/supporterCardScript.ts).
 * Framework-free and self-contained: one IIFE, no shared chunks.
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
      input: resolve(root, 'src/content/supporterCard.ts'),
      output: {
        ...sharedOutput,
        entryFileNames: 'content/supporter-card.js',
        format: 'iife',
        inlineDynamicImports: true,
        name: 'StreamPulseSupporterCard',
      },
    },
  },
})
