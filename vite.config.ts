import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// same as public/_headers (what Cloudflare serves in production) — see the
// comment there for why
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

export default defineConfig({
  plugins: [react()],
  // ES workers can code-split, so cut.worker.ts's dynamic import of
  // @imgly/background-removal stays a separate on-demand chunk (the default
  // iife format can't do that)
  worker: { format: 'es' },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: ['.trycloudflare.com'],
    headers: isolationHeaders,
  },
  preview: { headers: isolationHeaders },
})