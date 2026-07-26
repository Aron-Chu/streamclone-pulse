import { expect } from '@playwright/test'

const forbidden = /(raw.*chat|chat.*text|message.*text|chatter|user.*ranking|user.*id|username)/i

function scan(value: unknown, path: string[] = []): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => scan(item, [...path, String(index)]))
  if (!value || typeof value !== 'object') return []
  const failures: string[] = []
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = [...path, key]
    if (forbidden.test(key)) failures.push(nextPath.join('.'))
    if (typeof nested === 'string' && /^FORBIDDEN_/i.test(nested)) failures.push(nextPath.join('.'))
    failures.push(...scan(nested, nextPath))
  }
  return failures
}

export function expectNoForbiddenPayloadKeys(value: unknown): void {
  const failures = scan(value)
  expect(failures, failures.join('\n')).toEqual([])
}