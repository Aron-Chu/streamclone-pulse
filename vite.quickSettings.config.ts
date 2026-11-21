import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveTwitchSignInStage } from './scripts/extension-target.mjs'
import { QUICK_SETTINGS_SHARED_MODULES, QUICK_SETTINGS_SHARED_PACKAGES } from './src/shared/quickSettingsContract.ts'
import { extensionBuildId, extensionReleasePreview, extensionResolve, extensionTarget, isStoreBuild, sharedOutput } from './vite.shared.ts'

const root = fileURLToPath(new URL('.', import.meta.url))
const HOST = '__pulseQuickSettingsHost'
const VIRTUAL = '\0pulse-quick-settings-host:'

type SharedModule = keyof typeof QUICK_SETTINGS_SHARED_MODULES

function sharedModule(id: string): SharedModule | undefined {
  const path = relative(root, id.split('?')[0]).replaceAll('\\', '/')
  return path in QUICK_SETTINGS_SHARED_MODULES ? (path as SharedModule) : undefined
}

/**
 * Hands Quick settings the content script's React and stateful modules
 * (src/shared/quickSettingsContract.ts) instead of bundling copies. React
 * becomes a read of the host object; each shared module becomes a stand-in
 * that exports only what the contract lists, so importing anything else from
 * it fails this build rather than reading undefined at run time.
 */
function quickSettingsHost(): Plugin {
  return {
    name: 'pulse-quick-settings-host',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source in QUICK_SETTINGS_SHARED_PACKAGES) return { id: source, external: true }
      if (source.startsWith(VIRTUAL) || !importer) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      const shared = resolved && !resolved.external ? sharedModule(resolved.id) : undefined
      return shared ? VIRTUAL + shared : null
    },
    load(id) {
      if (!id.startsWith(VIRTUAL)) return null
      const exports: Record<string, string> = QUICK_SETTINGS_SHARED_MODULES[id.slice(VIRTUAL.length) as SharedModule]
      return Object.entries(exports)
        .map(([name, key]) => `export const ${name} = globalThis.${HOST}.${key}`)
        .join('\n')
    },
  }
}

// The host object carries React itself, so this build must not resolve it to a file.
const { react: _react, 'react-dom': _reactDom, ...packageAliases } = extensionResolve().alias

/**
 * content/quick-settings.js: the panel's Quick settings view, built on its own
 * so it never counts against the Twitch content script's size budget. The
 * worker injects it into a Twitch tab with chrome.scripting when the panel is
 * first hovered, focused or asked for its settings
 * (src/background/quickSettingsScript.ts). Unlike the other injected scripts
 * it renders in the overlay's React tree, so it takes React and the modules
 * that hold state from the content script (src/shared/quickSettingsContract.ts).
 */
export default defineConfig({
  root,
  plugins: [quickSettingsHost(), react()],
  resolve: { alias: packageAliases },
  // The same build constants as content/twitch.js (vite.content.config.ts).
  define: {
    __EXTENSION_STORE_BUILD__: JSON.stringify(isStoreBuild),
    __EXTENSION_TARGET__: JSON.stringify(extensionTarget),
    __EXTENSION_BUILD_ID__: JSON.stringify(extensionBuildId),
    __EXTENSION_RELEASE_PREVIEW__: JSON.stringify(extensionReleasePreview),
    __TWITCH_SIGNIN_STAGE__: JSON.stringify(resolveTwitchSignInStage(extensionTarget)),
  },
  build: {
    minify: 'terser',
    terserOptions: {
      safari10: false,
      compress: { passes: 2, toplevel: true },
      mangle: { toplevel: true },
    },
    outDir: 'dist',
    emptyOutDir: false,
    copyPublicDir: false,
    rollupOptions: {
      input: resolve(root, 'src/content/quickSettings.ts'),
      output: {
        ...sharedOutput,
        entryFileNames: 'content/quick-settings.js',
        format: 'iife',
        inlineDynamicImports: true,
        name: 'StreamPulseQuickSettings',
        globals: Object.fromEntries(
          Object.entries(QUICK_SETTINGS_SHARED_PACKAGES).map(([pkg, key]) => [pkg, `${HOST}.${key}`]),
        ),
      },
    },
  },
})
