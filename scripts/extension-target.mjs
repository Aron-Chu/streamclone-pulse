/**
 * Resolve extension packaging / build target (development | cws | edge | firefox).
 * Valid plain JavaScript — must pass: node --check scripts/extension-target.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export const EXTENSION_TARGETS = ['development', 'cws', 'edge', 'firefox']

export function resolveExtensionTarget(raw = process.env.EXTENSION_TARGET) {
  const value = String(raw ?? 'development').trim().toLowerCase()
  if (!EXTENSION_TARGETS.includes(value)) {
    throw new Error(
      `unknown EXTENSION_TARGET=${JSON.stringify(raw)}; expected one of ${EXTENSION_TARGETS.join(', ')}`,
    )
  }
  return value
}

export function manifestPathForTarget(target = resolveExtensionTarget()) {
  const path = join(root, 'manifests', `${target}.json`)
  if (!existsSync(path)) {
    throw new Error(`manifest missing for target ${target}: ${path}`)
  }
  return path
}

export function loadManifestForTarget(target = resolveExtensionTarget()) {
  return JSON.parse(readFileSync(manifestPathForTarget(target), 'utf8'))
}

export function isStoreTarget(target = resolveExtensionTarget()) {
  return target === 'cws' || target === 'edge' || target === 'firefox'
}

/** True when a permission / host string is any localhost or loopback origin. */
export function isLocalOrLoopbackHost(host) {
  const value = String(host ?? '').toLowerCase()
  return (
    value.includes('localhost')
    || value.includes('127.0.0.1')
    || value.includes('[::1]')
    || value.includes('0.0.0.0')
  )
}

/** Allow `node scripts/extension-target.mjs` smoke prints without side effects in imports. */
export function printResolvedTarget() {
  console.log(resolveExtensionTarget())
}
