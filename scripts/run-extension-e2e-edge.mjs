import { spawnSync } from 'node:child_process'

const root = process.cwd()

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    shell: true,
    stdio: 'inherit',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('npm', ['run', 'package:edge'])
// Same store-package checks as test:e2e:chrome / test:e2e:brave: the Edge
// manifest has no options_page, so the packaged shared settings host is the
// only settings surface and must render in Edge too.
run(
  'npx',
  [
    'playwright',
    'test',
    'tests/e2e/specs/quality.mocked.spec.ts',
    '--project=extension-mocked',
    '--grep',
    process.platform === 'win32'
      ? '"packaged shared settings host|no uncaught page or service-worker errors on live-ready path"'
      : 'packaged shared settings host|no uncaught page or service-worker errors on live-ready path',
  ],
  { ...process.env, PULSE_EXTENSION_BROWSER_CHANNEL: 'msedge' },
)
