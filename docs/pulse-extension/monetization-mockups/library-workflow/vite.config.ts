import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('.', import.meta.url))
export default defineConfig({ root, plugins: [react()], publicDir: false,
  server: { host: '127.0.0.1', port: 8178, strictPort: true, fs: { allow: [fileURLToPath(new URL('../../../../', import.meta.url))] } },
  build: { outDir: 'build', emptyOutDir: false },
})
