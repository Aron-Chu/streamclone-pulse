import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(packageRoot, '../..')

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'react-router', 'react-router-dom', '@tanstack/react-query', 'zustand'],
    alias: [
      {
        find: /^@streampulse\/pulse-charts\/(.*)$/,
        replacement: `${resolve(workspaceRoot, 'packages/pulse-charts/src')}/$1`,
      },
      {
        find: '@streampulse/pulse-charts',
        replacement: resolve(workspaceRoot, 'packages/pulse-charts/src/index.ts'),
      },
      {
        find: '@streampulse/pulse-core',
        replacement: resolve(workspaceRoot, 'packages/pulse-core/src/index.ts'),
      },
      // npm workspaces hoists React to the repository root. Resolve the
      // component graph to the same instance as Testing Library's renderer.
      { find: 'react', replacement: resolve(workspaceRoot, 'node_modules/react') },
      { find: 'react-dom', replacement: resolve(workspaceRoot, 'node_modules/react-dom') },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
