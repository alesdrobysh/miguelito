import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/miguelito/' : '/',
  plugins: [react(), tailwindcss()],
  define: {
    'process.env': '{}',
  },
  server: {
    host: true,
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  resolve: {
    alias: [
      // Node.js built-ins → browser shims
      { find: 'node:path', replacement: path.resolve(__dirname, 'src/browser-shims/path.ts') },
      { find: 'path',      replacement: path.resolve(__dirname, 'src/browser-shims/path.ts') },
      { find: 'node:fs',   replacement: path.resolve(__dirname, 'src/browser-shims/fs.ts') },
      { find: 'fs',        replacement: path.resolve(__dirname, 'src/browser-shims/fs.ts') },
      { find: 'pino',      replacement: path.resolve(__dirname, 'src/browser-shims/pino.ts') },
      { find: 'pino-pretty', replacement: path.resolve(__dirname, 'src/browser-shims/pino.ts') },
      // Force sql.js to resolve from web/node_modules even when imported from ../src/
      { find: 'sql.js', replacement: path.resolve(__dirname, 'node_modules/sql.js') },
    ],
  },
  optimizeDeps: {
    exclude: ['@mlc-ai/web-llm'],
  },
})
