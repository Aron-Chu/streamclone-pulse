import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadExtensionReleasePreview } from './scripts/release-preview.ts'

const root = fileURLToPath(new URL('.', import.meta.url))
const releasePreview = loadExtensionReleasePreview(resolve(root, 'src/shared/release-notes.json'))

export default defineConfig({
  define: {
    __EXTENSION_STORE_BUILD__: 'false',
    __EXTENSION_TARGET__: JSON.stringify('development'),
    __EXTENSION_RELEASE_PREVIEW__: JSON.stringify(releasePreview),
  },
  resolve: {
    alias: {
      '@streampulse/pulse-core': resolve(root, 'packages/pulse-core/src/index.ts'),
      '@streampulse/pulse-charts': resolve(root, 'packages/pulse-charts/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'tests/e2e/**',
      'scripts/**',
      'streampulse-web/**',
      // Analytics Console owns its own test environment/config; its source
      // tests are not extension tests and otherwise leak into root Vitest.
      'packages/analytics-console/**',
      'packages/**/tests/**',
      '**/.claude/**',
      '**/.worktrees/**',
      '_streamclone/**',
      '_streampulse-backend/**',
      '../twitch-7tv-clone/**',
      '../streampulse-backend/**',
    ],
  },
})
