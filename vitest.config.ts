import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'tests/e2e/**',
      'streampulse-web/**',
      '_streamclone/**',
      '_streampulse-backend/**',
      '../twitch-7tv-clone/**',
      '../streampulse-backend/**',
    ],
  },
})
