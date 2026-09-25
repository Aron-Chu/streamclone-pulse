import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extensionUiShimsPlugin } from './src/plugins/extensionUiShims'
import { rewriteReactRouterLocalhostPlugin } from './src/plugins/rewriteReactRouterLocalhost'

const __dirname = dirname(fileURLToPath(import.meta.url))
/** Extension checkout root (sibling of streampulse-web/) — landing showcase reuses overlay UI. */
const pulseRoot = resolve(__dirname, '..')

/** Guard the actual emitted import graph, not chunk names or total build size. */
function publicEntryBoundaryPlugin(): Plugin {
  return {
    name: 'streampulse-public-entry-boundary',
    apply: 'build',
    generateBundle(_options, bundle) {
      const visited = new Set<string>()
      const forbidden = new Set<string>()
      const visit = (fileName: string) => {
        if (visited.has(fileName)) return
        visited.add(fileName)
        const chunk = bundle[fileName]
        if (!chunk || chunk.type !== 'chunk') return
        for (const id of Object.keys(chunk.modules)) {
          if (/\/packages\/(?:analytics-console|pulse-charts)\//.test(id.replaceAll('\\', '/'))) forbidden.add(id)
        }
        for (const dependency of chunk.imports) visit(dependency)
      }
      for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk' && chunk.isEntry) visit(chunk.fileName)
      if (forbidden.size) this.error(`Public entry eagerly imports analytics UI:\n${[...forbidden].join('\n')}`)
      this.emitFile({ type: 'asset', fileName: 'public-entry-budget.json', source: JSON.stringify({
        staticJavaScript: [...visited].filter(name => name.endsWith('.js')).sort(),
        analyticsUiModules: [...forbidden],
      }, null, 2) })
    },
  }
}

function devConnectSrcPlugin(): Plugin {
  const devHosts = [
    'http://localhost:8081',
    'http://127.0.0.1:8081',
  ]
  // The dev discovery fixture shim (scripts/dev-discovery-fixture.mjs) stands in
  // for the hosted stored-discovery endpoints while they answer 503. It must be
  // reachable by `connect-src` or the portal's own CSP blocks the fetch before
  // the backend override is ever consulted. Kept out of `img-src`: the shim
  // serves JSON only. `apply: 'serve'` means none of this reaches a build.
  const fixturePort = Number(process.env.SP_FIXTURE_PORT || 8099)
  const fixtureHosts = Number.isFinite(fixturePort) && fixturePort > 0
    ? [`http://localhost:${fixturePort}`, `http://127.0.0.1:${fixturePort}`]
    : []
  const devConnect = [...devHosts, ...fixtureHosts].join(' ')
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

const plugins = [
  react(),
  extensionUiShimsPlugin(pulseRoot, __dirname),
  rewriteReactRouterLocalhostPlugin(),
  devConnectSrcPlugin(),
  publicEntryBoundaryPlugin(),
]

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
  server: {
    proxy: {
      '/v1': {
        target: 'http://localhost:8081',
        changeOrigin: false,
      },
    },
  },
  optimizeDeps: {
    // Discover lazy analytics motion dependencies before the first route visit.
    include: ['gsap', 'gsap/Flip'],
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
      // In-repo RPR-6 packages (src for Vite HMR; typecheck consumes dist via package exports)
      '@streampulse/analytics-console/analytics-chart-motion.css': resolve(
        pulseRoot,
        'packages/analytics-console/analytics-chart-motion.css',
      ),
      '@streampulse/analytics-console/session-signal-tape.css': resolve(
        pulseRoot,
        'packages/analytics-console/session-signal-tape.css',
      ),
      '@streampulse/pulse-charts/pulse-chart-motion.css': resolve(
        pulseRoot,
        'packages/pulse-charts/pulse-chart-motion.css',
      ),
      '@streampulse/analytics-console': resolve(pulseRoot, 'packages/analytics-console/src/index.tsx'),
      '@streampulse/pulse-charts': resolve(pulseRoot, 'packages/pulse-charts/src/index.ts'),
      '@streampulse/pulse-core': resolve(pulseRoot, 'packages/pulse-core/src/index.ts'),
      react: resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
      'react-router-dom': resolve(__dirname, 'node_modules/react-router-dom'),
      '@tanstack/react-query': resolve(__dirname, 'node_modules/@tanstack/react-query'),
      zustand: resolve(__dirname, 'node_modules/zustand'),
    },
  },
  build: {
    outDir: 'dist',
    manifest: true,
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules') && !id.includes('packages/')) return
          if (id.includes('gsap')) return 'vendor-gsap'
          // Let the bundler split analytics at the route boundary. Assigning all
          // console modules to one manual chunk pulled lazy UI into public entry.
          if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts'
        },
      },
    },
  },
})
