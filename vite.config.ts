import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
  },
})