/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Injected at build time by vite.config.ts — see the `define` block. */
declare const __APP_VERSION__: string
declare const __APP_COMMIT__: string
declare const __BUILT_AT__: string
