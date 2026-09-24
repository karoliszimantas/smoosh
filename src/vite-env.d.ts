/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MANIFEST_URL?: string
  readonly VITE_SERVER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
