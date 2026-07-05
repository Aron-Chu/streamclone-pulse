import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'react-router', 'react-router-dom', '@tanstack/react-query', 'zustand'],
    alias: {
      '@': resolve(__dirname, 'src'),
      '@streamclone/analytics-console': resolve(
        __dirname,
        '../../twitch-7tv-clone/packages/analytics-console/src/index.tsx',
      ),
      '@streamclone/pulse-charts': resolve(
        __dirname,
        '../../twitch-7tv-clone/packages/pulse-charts/src/index.ts',
      ),
      '@streamclone/pulse-core': resolve(__dirname, 'node_modules/@streamclone/pulse-core'),
      react: resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
      'react-router-dom': resolve(__dirname, 'node_modules/react-router-dom'),
      '@tanstack/react-query': resolve(__dirname, 'node_modules/@tanstack/react-query'),
      zustand: resolve(__dirname, 'node_modules/zustand'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
})
