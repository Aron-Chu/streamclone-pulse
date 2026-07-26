import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    // Package unit tests may run before dist/ is built; resolve workspace source.
    alias: {
      '@streampulse/pulse-core': resolve(root, '../pulse-core/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
  },
})
