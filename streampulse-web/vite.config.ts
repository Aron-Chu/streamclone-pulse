import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extensionUiShimsPlugin } from './src/plugins/extensionUiShims'

const __dirname = dirname(fileURLToPath(import.meta.url))
/** Extension checkout root (sibling of streampulse-web/) — landing showcase reuses overlay UI. */
const pulseRoot = resolve(__dirname, '..')

function devConnectSrcPlugin(): Plugin {
  const devHosts = [
    'http://localhost:8081',
    'http://127.0.0.1:8081',
  ]
  const devConnect = devHosts.join(' ')
  const devImg = devHosts.join(' ')
  return {
    name: 'streampulse-dev-connect-src',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        .replace(
          "connect-src 'self' https://api.streampulse.stream https://o4511718232686592.ingest.us.sentry.io",
          `connect-src 'self' https://api.streampulse.stream https://o4511718232686592.ingest.us.sentry.io ${devConnect}`,
        )
        .replace("img-src 'self' https: data:", `img-src 'self' https: data: ${devImg}`)
    },
  }
}

const sentryAuth = process.env.SENTRY_AUTH_TOKEN?.trim()
const sentryOrg = process.env.SENTRY_ORG?.trim() || 'streampulse'
const sentryProject = process.env.SENTRY_PROJECT?.trim() || 'streampulse-portal'
const sentryRelease = process.env.SENTRY_RELEASE?.trim()
const viteSentryDsn = process.env.VITE_SENTRY_DSN?.trim()

const plugins = [react(), extensionUiShimsPlugin(pulseRoot, __dirname), devConnectSrcPlugin()]

// Sentry Vite plugin must be last. Upload only when production DSN + auth + release are set.
if (viteSentryDsn && sentryAuth && sentryRelease) {
  plugins.push(
    sentryVitePlugin({
      org: sentryOrg,
      project: sentryProject,
      authToken: sentryAuth,
      release: {
        name: sentryRelease,
      },
      sourcemaps: {
        filesToDeleteAfterUpload: ['./dist/**/*.map'],
      },
    }),
  )
}

export default defineConfig({
  plugins,
  optimizeDeps: {
    // Linked local packages are aliased to source — prebundling freezes a stale
    // snapshot and silently drops props like highlightedGameSegmentKey after edits.
    exclude: [
      '@streampulse/pulse-charts',
      '@streampulse/pulse-core',
      '@streampulse/analytics-console',
    ],
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'react-router', 'react-router-dom', '@tanstack/react-query', 'zustand'],
    alias: {
      '@': resolve(__dirname, 'src'),
      // Landing ExtensionShowcase bundles real overlay components from this repo's src/ui.
      '@pulse-ext/ui': resolve(pulseRoot, 'src/ui'),
      '@streampulse/analytics-console': resolve(
        __dirname,
        'node_modules/@streampulse/analytics-console/src/index.tsx',
      ),
      '@streampulse/pulse-charts': resolve(
        __dirname,
        'node_modules/@streampulse/pulse-charts/src/index.ts',
      ),
      '@streampulse/pulse-core': resolve(__dirname, 'node_modules/@streampulse/pulse-core'),
      react: resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
      'react-router-dom': resolve(__dirname, 'node_modules/react-router-dom'),
      '@tanstack/react-query': resolve(__dirname, 'node_modules/@tanstack/react-query'),
      zustand: resolve(__dirname, 'node_modules/zustand'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules') && !id.includes('packages/')) return
          if (id.includes('gsap')) return 'vendor-gsap'
          if (id.includes('analytics-console') || id.includes('pulse-charts')) {
            return 'vendor-analytics-console'
          }
          if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts'
        },
      },
    },
  },
})
