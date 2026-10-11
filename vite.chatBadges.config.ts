import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extensionResolve, sharedOutput } from './vite.shared.ts'

const root = fileURLToPath(new URL('.', import.meta.url))

/**
 * content/chat-badges.js: the Seen in chat decorator, built on its own so it
 * never counts against the Twitch content script's size budget. The worker
 * registers it for Twitch pages with chrome.scripting only while there is a
 * Supporter list to show (src/background/chatBadgeScript.ts). Framework-free
 * and self-contained: one IIFE, no shared chunks. Its own gzip cap lives in
 * scripts/check-extension-bundle-budget.mjs.
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
      input: resolve(root, 'src/content/chatBadges.ts'),
      output: {
        ...sharedOutput,
        entryFileNames: 'content/chat-badges.js',
        format: 'iife',
        inlineDynamicImports: true,
        name: 'StreamPulseChatBadges',
      },
    },
  },
})
