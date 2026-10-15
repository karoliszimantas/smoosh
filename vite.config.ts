import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// same as public/_headers (what Cloudflare serves in production) — see the
// comment there for why
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

// Preload the three web fonts (src/themes/fonts.css) from index.html, so they
// download alongside the stylesheet instead of after it has been parsed and
// the page laid out. Build only: the hashed names exist only in the bundle,
// and in dev the fonts just load from the CSS.
function preloadFonts(): Plugin {
  let base = '/'
  return {
    name: 'preload-fonts',
    apply: 'build',
    configResolved: (config) => void (base = config.base),
    transformIndexHtml: (_html, { bundle = {} }) =>
      Object.keys(bundle)
        .filter((file) => /\/(archivo|courier-prime)-[^/]*\.woff2$/.test(file))
        .map((file) => ({
          tag: 'link',
          attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: base + file, crossorigin: true },
          injectTo: 'head' as const,
        })),
  }
}

export default defineConfig({
  plugins: [react(), preloadFonts()],
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