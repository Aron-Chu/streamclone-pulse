import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform as transformCss } from 'lightningcss'
import { shadowStyles } from './src/ui/theme.ts'
import { overlayBaseStyles } from './src/ui/overlayStyles.ts'
import { CHAT_STACK_CSS, EMOTE_PILE_CSS } from './src/supporter/styles.ts'
import { collectLightTokens, twitchLightCss } from './src/ui/twitchLightTheme.ts'
import { resolveTwitchSignInStage } from './scripts/extension-target.mjs'
import { reactDomNoInnerHtml } from './scripts/lib/react-dom-inner-html.mjs'
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

function minifyCss(code: string): string {
  return transformCss({
    filename: 'pulse-shadow.css',
    code: Buffer.from(code),
    minify: true,
    targets: { chrome: 109 << 16, firefox: 115 << 16 },
  }).code.toString()
}

/** The literal colours every tone() / ink() call in src passes. */
function lightTokens() {
  const tokens = { tone: new Set<string>(), ink: new Set<string>() }
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) collectLightTokens(readFileSync(path, 'utf8'), tokens)
    }
  }
  walk(resolve(root, 'src'))
  return tokens
}

// Twitch light mode for the panel host rides in shadow.css (outside the
// twitch.js size cap). It is derived from the dark CSS in the order the shadow
// root applies it: the inline base styles, then this stylesheet.
// Pieces that inject their own <style> into the shadow root later (lazy
// chunks and the Supporter card's stage) get light twins too. The first two
// are read from source, since their modules touch the DOM on import.
function injectedStyles(): string {
  return ['src/content/catchMeUp.ts', 'src/content/momentFrames.ts']
    .map(file => /^const CSS = `([\s\S]*?)^`/m.exec(readFileSync(resolve(root, file), 'utf8'))?.[1] ?? '')
    .join('') + CHAT_STACK_CSS + EMOTE_PILE_CSS
}

const minifiedShadowStyles = minifyCss(shadowStyles)
const shadowStylesheet = minifiedShadowStyles + minifyCss(twitchLightCss({
  css: minifyCss(overlayBaseStyles) + minifiedShadowStyles + minifyCss(injectedStyles()),
  tokens: lightTokens(),
}))

export default defineConfig({
  root,
  plugins: [
    // content/twitch.js bundles its own React DOM (Firefox add-on lint).
    reactDomNoInnerHtml(),
    react(),
    {
      name: 'minify-extension-shadow-theme-css',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'content/shadow.css',
          source: shadowStylesheet,
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
    // Panel copy (bookmarks) follows the build's sign-in stage, like the worker
    // and options do. Without it the content script always read 'off'.
    __TWITCH_SIGNIN_STAGE__: JSON.stringify(resolveTwitchSignInStage(extensionTarget)),
  },
  build: {
    minify: 'terser',
    // Hoist declarations for better gzip reuse in the single MV3 content IIFE.
    // The content entry is wrapped as a self-contained IIFE, so module-scope
    // names are not part of a public API and can be safely compressed/mangled.
    terserOptions: {
      // Vite turns on terser's Safari 10 workarounds by default; the extension
      // ships to Chromium and Firefox only, so they are dead weight here.
      safari10: false,
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
