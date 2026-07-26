import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extensionResolve, extensionTarget, isStoreBuild, sharedOutput } from './vite.shared.ts'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  plugins: [react()],
  resolve: extensionResolve(),
  define: {
    __EXTENSION_STORE_BUILD__: JSON.stringify(isStoreBuild),
    __EXTENSION_TARGET__: JSON.stringify(extensionTarget),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(root, 'src/content/entry.ts'),
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
