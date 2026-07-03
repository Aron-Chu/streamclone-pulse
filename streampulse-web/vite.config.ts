import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// The committed index.html CSP is production-clean: connect-src/img-src only allow
// 'self', https:, and the hosted API (https://api.streampulse.stream). Local dev
// backends (localhost / 127.0.0.1 / a laptopworker tailnet hub) are injected here
// ONLY for `vite` / `vite dev` (apply: 'serve'), so production builds never carry a
// dependency on a developer machine. check-backend-url enforces this on dist.
//
// img-src needs the same dev hosts as connect-src: locally-synced 7TV/FFZ/BTTV
// emote thumbnails are served from the analytics backend itself (e.g.
// `/emotes/{uuid}/1x.webp`, resolved to an absolute `http://127.0.0.1:8090/...`
// URL client-side) — without this, those <img> tags are silently CSP-blocked
// even though the URL itself is correct.
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
  resolve: {
    dedupe: ['react', 'react-dom', 'react-router', 'react-router-dom', '@tanstack/react-query', 'zustand'],
    alias: {
      '@': resolve(__dirname, 'src'),
      '@streamclone/analytics-console': resolve(
        __dirname,
        '../../twitch-7tv-clone/packages/analytics-console/src/index.tsx',
      ),
      '@streamclone/pulse-core': resolve(__dirname, 'node_modules/@streamclone/pulse-core'),
      react: resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
      'react-router-dom': resolve(__dirname, 'node_modules/react-router-dom'),
      '@tanstack/react-query': resolve(__dirname, 'node_modules/@tanstack/react-query'),
      zustand: resolve(__dirname, 'node_modules/zustand'),
    },
  },
  build: {
    outDir: 'dist',
  },
})
