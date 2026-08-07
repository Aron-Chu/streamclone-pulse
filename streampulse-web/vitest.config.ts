import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pulseRoot = resolve(__dirname, '..')

const analyticsConsoleRoot = resolve(__dirname, 'node_modules/@streampulse/analytics-console')
const pulseChartsRoot = resolve(__dirname, 'node_modules/@streampulse/pulse-charts')

export default defineConfig({
  plugins: [react()],
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'react-router', 'react-router-dom', '@tanstack/react-query', 'zustand'],
    alias: [
      { find: '@', replacement: resolve(__dirname, 'src') },
      { find: '@pulse-ext/ui', replacement: resolve(pulseRoot, 'src/ui') },
      {
        find: /^@streampulse\/analytics-console\/(.*)$/,
        replacement: `${resolve(analyticsConsoleRoot, 'src')}/$1`,
      },
      {
        find: '@streampulse/analytics-console',
        replacement: resolve(analyticsConsoleRoot, 'src/index.tsx'),
      },
      {
        find: /^@streampulse\/pulse-charts\/(.*)$/,
        replacement: `${pulseChartsRoot}/$1`,
      },
      {
        find: '@streampulse/pulse-charts',
        replacement: resolve(pulseChartsRoot, 'src/index.ts'),
      },
      { find: '@streampulse/pulse-core', replacement: resolve(__dirname, 'node_modules/@streampulse/pulse-core') },
      { find: 'react', replacement: resolve(__dirname, 'node_modules/react') },
      { find: 'react-dom', replacement: resolve(__dirname, 'node_modules/react-dom') },
      { find: 'react-router-dom', replacement: resolve(__dirname, 'node_modules/react-router-dom') },
      { find: '@tanstack/react-query', replacement: resolve(__dirname, 'node_modules/@tanstack/react-query') },
      { find: 'zustand', replacement: resolve(__dirname, 'node_modules/zustand') },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    hookTimeout: 30_000,
    testTimeout: 120_000,
    setupFiles: ['./tests/setup.ts'],
    exclude: [
      'tests/e2e/**',
      'node_modules/**',
    ],
    server: {
      deps: {
        inline: [analyticsConsoleRoot, pulseChartsRoot],
      },
    },
  },
})
