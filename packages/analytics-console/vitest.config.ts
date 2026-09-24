import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { defineConfig } from 'vitest/config'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const pulseRoot = resolve(packageRoot, '../..')
const require = createRequire(import.meta.url)

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'react-router', 'react-router-dom', '@tanstack/react-query', 'zustand'],
    alias: [
      {
        find: /^@streampulse\/pulse-charts\/(.*)$/,
        replacement: `${resolve(pulseRoot, 'packages/pulse-charts/src')}/$1`,
      },
      {
        find: '@streampulse/pulse-charts',
        replacement: resolve(pulseRoot, 'packages/pulse-charts/src/index.ts'),
      },
      {
        find: '@streampulse/pulse-core',
        replacement: resolve(pulseRoot, 'packages/pulse-core/src/index.ts'),
      },
      // Testing Library is installed in this package workspace. Resolve the
      // component graph to the same React instance as its renderer.
      { find: 'react', replacement: dirname(require.resolve('react/package.json')) },
      { find: 'react-dom', replacement: dirname(require.resolve('react-dom/package.json')) },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
