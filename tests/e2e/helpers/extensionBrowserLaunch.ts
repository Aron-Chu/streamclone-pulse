/**
 * Picks the browser the extension e2e harness launches.
 *
 * Playwright's default headless browser is the headless shell, which never
 * loads MV3 extensions: every test then waits 30 s for a service worker that
 * cannot start (and CI=1 retries it once more). Headless runs therefore use
 * the full Chromium build ("chromium" channel, new headless mode) unless the
 * caller names a channel or an executable explicitly.
 */
export interface ExtensionBrowserLaunch {
  channel: string | undefined
  executablePath: string | undefined
}

export function resolveExtensionBrowserLaunch(
  headless: boolean,
  env: Record<string, string | undefined> = process.env,
): ExtensionBrowserLaunch {
  const executablePath = env.PULSE_EXTENSION_BROWSER_EXECUTABLE_PATH?.trim() || undefined
  if (executablePath) return { channel: undefined, executablePath }
  const channel = env.PULSE_EXTENSION_BROWSER_CHANNEL?.trim() || (headless ? 'chromium' : undefined)
  return { channel, executablePath: undefined }
}

export function extensionServiceWorkerTimeoutMessage(timeoutMs: number, launch: ExtensionBrowserLaunch): string {
  const browser = launch.executablePath ?? launch.channel ?? 'default bundled browser'
  return `Extension service worker did not start within ${timeoutMs} ms (browser: ${browser}). ` +
    'Check that dist/ is built and that the browser loads MV3 extensions; the headless shell does not ' +
    '(use PULSE_EXTENSION_BROWSER_CHANNEL=chromium).'
}
