import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform as transformCss } from 'lightningcss'
import { shadowStyles } from './src/ui/theme.ts'
import { overlayBaseStyles } from './src/ui/overlayStyles.ts'
import { extensionBuildId, extensionReleasePreview, extensionResolve, extensionTarget, isStoreBuild, sharedOutput } from './vite.shared.ts'

const root = fileURLToPath(new URL('.', import.meta.url))

/** Keep Shadow DOM source readable while shipping a compact CSS string. */
function minifyInlineCss(code: string, marker: string, resolvedCss?: string): string {
  const start = code.indexOf(marker)
  if (start < 0) return code
  const contentStart = start + marker.length
  const end = code.indexOf('`', contentStart)
  if (end < 0) return code

  const sourceCss = resolvedCss ?? code.slice(contentStart, end)
  if (sourceCss.includes('${')) throw new Error('Inline CSS must be resolved before minification')
  const css = transformCss({
    filename: 'pulse-shadow.css',
    code: Buffer.from(sourceCss),
    minify: true,
    targets: { chrome: 109 << 16, firefox: 115 << 16 },
  }).code.toString()
  return `${code.slice(0, contentStart - 1)}${JSON.stringify(css)}${code.slice(end + 1)}`
}

const minifiedShadowStyles = transformCss({
  filename: 'pulse-shadow.css',
  code: Buffer.from(shadowStyles),
  minify: true,
  targets: { chrome: 109 << 16, firefox: 115 << 16 },
}).code.toString()

export default defineConfig({
  root,
  plugins: [
    react(),
    {
      name: 'minify-extension-shadow-theme-css',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'content/shadow.css',
          source: minifiedShadowStyles,
        })
      },
      transform(code, id) {
        const path = id.replaceAll('\\', '/')
        if (path.endsWith('/src/ui/overlayStyles.ts')) {
          return { code: minifyInlineCss(code, 'export const overlayBaseStyles = `', overlayBaseStyles), map: null }
        }
        if (path.endsWith('/src/ui/theme.ts')) {
          return { code: minifyInlineCss(code, 'export const shadowStyles = `', shadowStyles), map: null }
        }
        if (path.endsWith('/src/ui/PulseBanner.tsx')) {
          return { code: minifyInlineCss(code, 'const BANNER_CSS = `'), map: null }
        }
        return null
      },
    },
  ],
  resolve: extensionResolve(),
  define: {
    __EXTENSION_STORE_BUILD__: JSON.stringify(isStoreBuild),
    __EXTENSION_TARGET__: JSON.stringify(extensionTarget),
    __EXTENSION_BUILD_ID__: JSON.stringify(extensionBuildId),
    __EXTENSION_RELEASE_PREVIEW__: JSON.stringify(extensionReleasePreview),
  },
  build: {
    minify: 'terser',
    // Hoist declarations for better gzip reuse in the single MV3 content IIFE.
    // The content entry is wrapped as a self-contained IIFE, so module-scope
    // names are not part of a public API and can be safely compressed/mangled.
    terserOptions: {
      compress: { passes: 3, hoist_funs: true, toplevel: true },
      mangle: { toplevel: true },
    },
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(root, 'src/content/entry.ts'),
      output: {
        ...sharedOutput,
        entryFileNames: 'content/twitch.js',
        format: 'iife',
        inlineDynamicImports: true,
        name: 'StreamclonePulseContent',
      },
    },
  },
})
