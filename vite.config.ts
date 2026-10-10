import { build as viteBuild, defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { loadManifestForTarget, manifestForTwitchSignInStage, resolveSupporterBackendOrigin, resolveTwitchSignInStage } from './scripts/extension-target.mjs'
import { resolveChatBadgeDevKeys } from './scripts/chat-badge-keys.mjs'
import { extensionBuildId, extensionReleasePreview, extensionResolve, extensionTarget, isStoreBuild, sharedOutput } from './vite.shared.ts'

const root = __dirname
const supporterBackendOrigin = resolveSupporterBackendOrigin(extensionTarget)
// Worker and options only: the content script never carries sign-in code.
const twitchSignInStage = resolveTwitchSignInStage(extensionTarget)

function copyToDist(rootDir: string, relativePath: string): void {
  const src = resolve(rootDir, relativePath)
  const dest = resolve(rootDir, 'dist', relativePath)
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
}

function chromeExtensionPlugin() {
  return {
    name: 'streamclone-pulse-extension',
    async closeBundle() {
      // One-shot builds: content IIFE via dedicated config (dev watch uses the same file).
      await viteBuild({ configFile: resolve(__dirname, 'vite.content.config.ts') })
      // The Supporter card's stage, injected on demand; never part of content/twitch.js.
      await viteBuild({ configFile: resolve(__dirname, 'vite.supporterCard.config.ts') })
      // The Seen in chat decorator, registered by the worker only while there is a list to show.
      await viteBuild({ configFile: resolve(__dirname, 'vite.chatBadges.config.ts') })

      const dist = resolve(__dirname, 'dist')
      mkdirSync(dist, { recursive: true })
      const manifest = manifestForTwitchSignInStage(loadManifestForTarget(extensionTarget), extensionTarget, twitchSignInStage)
      writeFileSync(resolve(dist, 'manifest.json'), JSON.stringify(manifest, null, 2))
      writeFileSync(
        resolve(dist, 'extension-target.json'),
        JSON.stringify({ buildId: extensionBuildId, target: extensionTarget, version: manifest.version, supporterBackendOrigin }, null, 2),
      )
      const pages = ['popup/index.html', 'options/index.html'] as const
      for (const page of pages) {
        copyToDist(__dirname, page)
      }
      mkdirSync(resolve(dist, 'icons'), { recursive: true })
      for (const size of [16, 48, 128]) {
        copyFileSync(resolve(__dirname, `public/icons/icon${size}.png`), resolve(dist, `icons/icon${size}.png`))
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), chromeExtensionPlugin()],
  resolve: extensionResolve(),
  define: {
    __EXTENSION_STORE_BUILD__: JSON.stringify(isStoreBuild),
    __SUPPORTER_BACKEND_ORIGIN__: JSON.stringify(supporterBackendOrigin),
    __EXTENSION_TARGET__: JSON.stringify(extensionTarget),
    __EXTENSION_TARGET_MARKER__: JSON.stringify(
      `streampulse-extension-runtime-target:${extensionTarget}`,
    ),
    __EXTENSION_BUILD_ID__: JSON.stringify(extensionBuildId),
    __EXTENSION_RELEASE_PREVIEW__: JSON.stringify(extensionReleasePreview),
    __TWITCH_SIGNIN_STAGE__: JSON.stringify(twitchSignInStage),
    // Seen in chat list keys: development builds only; store builds pin production keys in source.
    __CHAT_BADGE_DEV_KEYS__: JSON.stringify(resolveChatBadgeDevKeys(extensionTarget)),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'background/service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
        'popup/popup': resolve(__dirname, 'src/popup/popup.tsx'),
        'options/options': resolve(
          __dirname,
          isStoreBuild ? 'src/options/storeOptions.tsx' : 'src/options/options.tsx',
        ),
      },
      output: sharedOutput,
    },
  },
})
