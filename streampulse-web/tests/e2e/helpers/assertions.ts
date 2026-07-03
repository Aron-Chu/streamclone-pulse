import { expect, type Page } from '@playwright/test'

export function attachConsoleErrorGuard(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

export async function assertNoConsoleErrors(_page: Page, errors: string[]): Promise<void> {
  expect(errors, errors.join('\n')).toEqual([])
}