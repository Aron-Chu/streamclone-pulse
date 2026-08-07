import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { dirname, resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extensionUiShimsPlugin } from './src/plugins/extensionUiShims'
import { getBuildProvenance, writeBuildProvenance } from '../scripts/build-provenance.mjs'

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

const portalInputScope = [
  'streampulse-web/src',
  'streampulse-web/public',
  'streampulse-web/index.html',
  'streampulse-web/vite.config.ts',
  'scripts/build-provenance.mjs',
  'streampulse-web/package.json',
  'streampulse-web/package-lock.json',
  // The landing showcase intentionally aliases these extension modules.
  'src/ui',
  'src/shared',
]

const portalBuildMeta = getBuildProvenance({
  repoRoot: pulseRoot,
  repository: 'streampulse-portal',
  mode: process.env.PULSE_BUILD_MODE?.trim() || 'source',
  scope: portalInputScope,
})

function portalRuntimeIdentity(metadata: typeof portalBuildMeta) {
  const packageCohort = metadata.packageCohortFingerprint || 'unknown'
  return {
    status: 'ok',
    service: 'streampulse-portal',
    version: process.env.VITE_PORTAL_VERSION?.trim() || 'dev',
    buildSha: metadata.commit,
    buildId: metadata.buildId,
    mode: metadata.mode,
    dirty: metadata.dirty,
    dirtyTreeHash: metadata.dirtyTreeHash,
    sourceFingerprint: metadata.sourceFingerprint,
    packageCohortFingerprint: packageCohort,
    snapshotId: process.env.PULSE_RUNTIME_SNAPSHOT_ID?.trim() || null,
    serviceGeneration: `streampulse-portal:${metadata.commit === 'unknown' ? 'unknown' : metadata.commit.slice(0, 12)}:${metadata.dirtyTreeHash === 'clean' ? 'clean' : metadata.dirtyTreeHash.slice(0, 12)}:${packageCohort.slice(0, 12)}`,
  }
}

function currentPortalBuildMeta() {
  try {
    // Recompute for dev health requests. Linked @streampulse/* packages live
    // outside this Vite graph, so a static config-time identity can otherwise
    // claim an old cohort while HMR is serving newer module code.
    return getBuildProvenance({
      repoRoot: pulseRoot,
      repository: 'streampulse-portal',
      mode: process.env.PULSE_BUILD_MODE?.trim() || 'source',
      scope: portalInputScope,
    })
  } catch {
    // Health must remain useful during a partially-installed checkout. The
    // config-time snapshot still identifies the server and its last-known
    // cohort without hiding the failure behind a hard startup error.
    return portalBuildMeta
  }
}

function buildProvenancePlugin(): Plugin {
  return {
    name: 'streampulse-build-provenance',
    writeBundle() {
      const metadata = getBuildProvenance({
        repoRoot: pulseRoot,
        repository: 'streampulse-portal',
        mode: process.env.PULSE_BUILD_MODE?.trim() || 'source',
        scope: portalInputScope,
      })
      writeBuildProvenance(
        resolve(__dirname, 'dist'),
        metadata,
      )
      writeFileSync(
        resolve(__dirname, 'dist', 'runtime-identity.json'),
        `${JSON.stringify(portalRuntimeIdentity(metadata), null, 2)}\n`,
        'utf8',
      )
    },
    configureServer(server) {
      server.middlewares.use('/healthz', (_request, response) => {
        const identity = portalRuntimeIdentity(currentPortalBuildMeta())
        response.statusCode = 200
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(`${JSON.stringify(identity)}\n`)
      })
    },
  }
}

const plugins = [
  react(),
  extensionUiShimsPlugin(pulseRoot, __dirname),
  devConnectSrcPlugin(),
  buildProvenancePlugin(),
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
  define: {
    __STREAMPULSE_BUILD_META__: JSON.stringify(portalBuildMeta),
  },
  server: {
    host: '127.0.0.1',
    // Reserve 5173 for the watch UI. Fail instead of silently moving to 5175.
    port: 5174,
    strictPort: true,
  },
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
    alias: [
      {
        find: /^@streampulse\/analytics-console\/(.*)$/,
        replacement: `${resolve(__dirname, 'node_modules/@streampulse/analytics-console/src')}/$1`,
      },
      {
        find: /^@streampulse\/pulse-charts\/(.*)$/,
        replacement: `${resolve(__dirname, 'node_modules/@streampulse/pulse-charts')}/$1`,
      },
      { find: '@', replacement: resolve(__dirname, 'src') },
      // Landing ExtensionShowcase bundles real overlay components from this repo's src/ui.
      { find: '@pulse-ext/ui', replacement: resolve(pulseRoot, 'src/ui') },
      {
        find: /^@streampulse\/analytics-console$/,
        replacement: resolve(__dirname, 'node_modules/@streampulse/analytics-console/src/index.tsx'),
      },
      {
        find: /^@streampulse\/pulse-charts$/,
        replacement: resolve(__dirname, 'node_modules/@streampulse/pulse-charts/src/index.ts'),
      },
      { find: '@streampulse/pulse-core', replacement: resolve(__dirname, 'node_modules/@streampulse/pulse-core') },
      { find: 'react', replacement: resolve(__dirname, 'node_modules/react') },
      { find: 'react-dom', replacement: resolve(__dirname, 'node_modules/react-dom') },
      { find: 'react-router-dom', replacement: resolve(__dirname, 'node_modules/react-router-dom') },
      { find: '@tanstack/react-query', replacement: resolve(__dirname, 'node_modules/@tanstack/react-query') },
      { find: 'zustand', replacement: resolve(__dirname, 'node_modules/zustand') },
    ],
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
