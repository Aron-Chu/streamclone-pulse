import { DEFAULT_BACKEND_URL, isLocalStackBackendUrl } from './storage.ts'

export type ExtensionBackendSource = 'hosted' | 'local' | 'custom'

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** Classify which API the extension reads (matches portal backendSource labels). */
export function resolveExtensionBackendSource(url: string): ExtensionBackendSource {
  const resolved = normalizeUrl(url)
  if (resolved === normalizeUrl(DEFAULT_BACKEND_URL)) return 'hosted'
  if (isLocalStackBackendUrl(resolved)) return 'local'
  return 'custom'
}

export function extensionBackendSourceLabel(source: ExtensionBackendSource): string {
  switch (source) {
    case 'hosted':
      return 'Hosted corpus'
    case 'local':
      return 'Local stack'
    case 'custom':
      return 'Custom API'
  }
}

export function extensionBackendSourceCaption(url: string): string {
  const source = resolveExtensionBackendSource(url)
  let host: string
  try {
    host = new URL(url).host
  } catch {
    host = url
  }
  return `${extensionBackendSourceLabel(source)} · ${host}`
}
