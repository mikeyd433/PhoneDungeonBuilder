// Bundles src/features/export/phoneExport.ts for the Android app, which runs it
// in QuickJS. One exporter, two places: see that file's header.
import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
await build({
  configFile: false,
  logLevel: 'warn',
  resolve: { alias: { '@': resolve(root, 'src') } },
  build: {
    lib: { entry: resolve(root, 'src/features/export/phoneExport.ts'), name: 'JackieExport', formats: ['iife'], fileName: () => 'exporter.js' },
    outDir: resolve(root, 'android/app/src/main/assets/js'),
    emptyOutDir: false,
    minify: false,
    target: 'es2020',
    copyPublicDir: false,
  },
})
