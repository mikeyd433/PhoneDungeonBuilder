import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Base path is /delve/ because Dabingabongo's Netlify config serves this app at
// dabingabongo.com/delve (see netlify.toml in that repo). Overridable for a
// standalone deploy via DELVE_BASE.
const base = process.env.DELVE_BASE ?? '/delve/'

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
})
