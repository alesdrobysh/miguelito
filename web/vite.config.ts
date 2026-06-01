import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const root = path.resolve(__dirname, '..')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  resolve: {
    alias: [
      // Redirect Spanish asset loading to browser adapter (?raw instead of fs)
      {
        find: path.resolve(root, 'src/languages/spanish/assets.ts'),
        replacement: path.resolve(__dirname, 'src/languages/spanish/assets.ts'),
      },
      // Node.js built-ins → browser shims
      { find: 'node:path', replacement: path.resolve(__dirname, 'src/browser-shims/path.ts') },
      { find: 'path',      replacement: path.resolve(__dirname, 'src/browser-shims/path.ts') },
      { find: 'node:fs',   replacement: path.resolve(__dirname, 'src/browser-shims/fs.ts') },
      { find: 'fs',        replacement: path.resolve(__dirname, 'src/browser-shims/fs.ts') },
      { find: 'pino',      replacement: path.resolve(__dirname, 'src/browser-shims/pino.ts') },
      { find: 'pino-pretty', replacement: path.resolve(__dirname, 'src/browser-shims/pino.ts') },
    ],
  },
  optimizeDeps: {
    exclude: ['@mlc-ai/web-llm', 'sql.js'],
  },
})
