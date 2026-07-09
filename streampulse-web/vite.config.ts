import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function devConnectSrcPlugin(): Plugin {
  const devHosts = [
    'http://localhost:8090',
    'http://127.0.0.1:8090',
    'http://laptopworker:8090',
  ]
  const devConnect = [...devHosts, 'ws://localhost:8090', 'ws://127.0.0.1:8090'].join(' ')
  const devImg = devHosts.join(' ')
  return {
    name: 'streampulse-dev-connect-src',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        .replace(
          "connect-src 'self' https://api.streampulse.stream",
          `connect-src 'self' https://api.streampulse.stream ${devConnect}`,
        )
        .replace("img-src 'self' https: data:", `img-src 'self' https: data: ${devImg}`)
    },
  }
}

export default defineConfig({
  plugins: [react(), devConnectSrcPlugin()],
  optimizeDeps: {
    include: [
      '@streampulse/pulse-charts',
      '@streampulse/pulse-core',
      '@streampulse/analytics-console',
    ],
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'react-router', 'react-router-dom', '@tanstack/react-query', 'zustand'],
    alias: {
      '@': resolve(__dirname, 'src'),
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
