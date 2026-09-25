/** Deliberate allowlist. Never inspect storage, cookies, URL queries, or request headers. */
export function supportDiagnostics(input: { userAgent: string; online: boolean; width: number; height: number }): string {
  const browser = input.userAgent.match(/(?:Edg|Chrome|Firefox|Version)\/\d+/)?.[0] ?? 'Unknown browser'
  return [
    'Product: StreamPulse portal',
    `Browser: ${browser}`,
    `Browser reports online: ${input.online ? 'yes' : 'no'}`,
    `Viewport: ${Math.max(0, Math.round(input.width))} × ${Math.max(0, Math.round(input.height))}`,
    'Extension version: please add from chrome://extensions',
    'What happened: please describe without account secrets or raw chat',
  ].join('\n')
}
