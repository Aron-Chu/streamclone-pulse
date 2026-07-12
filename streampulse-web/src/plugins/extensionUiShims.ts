import { dirname, resolve } from 'node:path'
import type { Plugin } from 'vite'

const SHIM_FILES = ['storage.ts', 'bridge.ts'] as const

/** Redirect extension chrome-dependent modules to portal shims when bundling extension UI. */
export function extensionUiShimsPlugin(pulseRoot: string, portalRoot: string): Plugin {
  const shimsDir = resolve(portalRoot, 'src/shims')

  function shimFor(resolvedPath: string): string | null {
    const normalized = resolvedPath.replace(/\\/g, '/')
    if (normalized.endsWith('/src/shared/storage.ts')) {
      return resolve(shimsDir, 'extension-storage.ts')
    }
    if (normalized.endsWith('/src/content/bridge.ts')) {
      return resolve(shimsDir, 'extension-bridge.ts')
    }
    return null
  }

  return {
    name: 'streampulse-extension-ui-shims',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer?.replace(/\\/g, '/').includes('streamclone-pulse')) return null
      if (!SHIM_FILES.some(name => source.includes(name))) return null
      const resolved = source.startsWith('.')
        ? resolve(dirname(importer), source.split('?')[0]!)
        : source
      return shimFor(resolved)
    },
  }
}
