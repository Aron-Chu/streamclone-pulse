import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveViteArgs } from './dev-portal-config.mjs'

test('defaults to an explicit loopback host', () => {
  assert.deepEqual(resolveViteArgs([]), ['--host', '127.0.0.1', '--port', '5173', '--strictPort'])
})

test('watch flags do not accidentally enable network exposure', () => {
  assert.deepEqual(resolveViteArgs(['--watch-config']), ['--host', '127.0.0.1', '--port', '5173', '--strictPort'])
})

test('--lan is an explicit opt-in to all interfaces', () => {
  assert.deepEqual(resolveViteArgs(['--lan', '--port', '5180']), ['--host', '0.0.0.0', '--port', '5180', '--strictPort'])
})

test('preserves an explicitly selected host', () => {
  assert.deepEqual(resolveViteArgs(['--host', '127.0.0.2']), ['--host', '127.0.0.2', '--strictPort'])
})
