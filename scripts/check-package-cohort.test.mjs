import test from 'node:test'
import assert from 'node:assert/strict'
import { packageDependencies, parseFileSpec } from './check-package-cohort.mjs'

test('only relative file specs are accepted', () => {
  assert.equal(parseFileSpec('file:../streampulse-backend/packages/pulse-core'), '../streampulse-backend/packages/pulse-core')
  assert.equal(parseFileSpec('^1.0.0'), null)
  assert.equal(parseFileSpec('file:C:/private/package'), null)
})

test('collects @streampulse file dependencies from all dependency fields', () => {
  const found = packageDependencies({
    dependencies: {
      '@streampulse/pulse-core': 'file:../streampulse-backend/packages/pulse-core',
      react: '18.3.1',
    },
    devDependencies: {
      '@streampulse/analytics-console': 'file:../../streampulse-backend/packages/analytics-console',
    },
  }, 'C:/workspace/streamclone-pulse/streampulse-web')
  assert.deepEqual(found.map(({ name, field, relativePath }) => ({ name, field, relativePath })), [
    {
      name: '@streampulse/pulse-core',
      field: 'dependencies',
      relativePath: '../streampulse-backend/packages/pulse-core',
    },
    {
      name: '@streampulse/analytics-console',
      field: 'devDependencies',
      relativePath: '../../streampulse-backend/packages/analytics-console',
    },
  ])
})
