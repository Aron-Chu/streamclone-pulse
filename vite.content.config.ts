import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extensionResolve, extensionTarget, isStoreBuild, sharedOutput } from './vite.shared.ts'

const root = fileURLToPath(new URL('.', import.meta.url))

/** Keep Shadow DOM source readable while shipping a compact CSS string. */
function minifyShadowThemeCss(code: string): string {
  const marker = 'export const shadowStyles = `'
  const start = code.indexOf(marker)
  if (start < 0) return code
  const contentStart = start + marker.length
  const end = code.indexOf('`', contentStart)
  if (end < 0) return code

  const expressions: string[] = []
  const css = code.slice(contentStart, end).replace(/\$\{[^}]*\}/g, expression => {
    const token = `__PULSE_THEME_EXPR_${expressions.length}__`
    expressions.push(expression)
    return token
  })
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim()

  let restored = css
  expressions.forEach((expression, index) => {
    restored = restored.replace(`__PULSE_THEME_EXPR_${index}__`, expression)
  })
  return `${code.slice(0, contentStart)}${restored}${code.slice(end)}`
}

export default defineConfig({
  root,
  plugins: [
    react(),
    {
      name: 'minify-extension-shadow-theme-css',
      transform(code, id) {
        if (!id.replaceAll('\\', '/').endsWith('/src/ui/theme.ts')) return null
        return { code: minifyShadowThemeCss(code), map: null }
      },
    },
  ],
  resolve: extensionResolve(),
  define: {
    __EXTENSION_STORE_BUILD__: JSON.stringify(isStoreBuild),
    __EXTENSION_TARGET__: JSON.stringify(extensionTarget),
  },
  build: {
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
