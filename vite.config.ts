import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Base path is /delve/ because Dabingabongo's Netlify config serves this app at
// dabingabongo.com/delve (see netlify.toml in that repo). Overridable for a
// standalone deploy via DELVE_BASE.
const base = process.env.DELVE_BASE ?? '/delve/'

export default defineConfig({
  base,
  plugins: [
    react(),
    // F7.2 — installable, fullscreen on a tablet. Precaching the shell and the
    // self-hosted fonts is what makes the app usable at all on bad signal;
    // Supabase calls still need the network, which is what the offline write
    // queue in F7.4 is for.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,svg}'],
        // Never serve a stale API response as if it were fresh story data.
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//],
      },
      manifest: {
        name: 'The Delve',
        short_name: 'Delve',
        description: 'A dungeon-crawl authoring tool for a phone adventure.',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#141010',
        theme_color: '#141010',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
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
