import { spawnSync } from 'node:child_process'

process.env.VITE_BACKEND_URL = process.env.VITE_BACKEND_URL || 'http://127.0.0.1:8090'
process.env.PLAYWRIGHT_LOCAL_ANALYTICS = '1'
process.env.PLAYWRIGHT_BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173'

const result = spawnSync(
  'npx',
  ['playwright', 'test', 'tests/e2e/analytics-console-local-sessions.spec.ts'],
  { stdio: 'inherit', shell: true, env: process.env },
)

process.exit(result.status ?? 1)
