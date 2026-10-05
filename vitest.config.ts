import { defineConfig } from 'vitest/config'

// client tests. Separate from vite.config.ts: vitest 3 runs on its own vite,
// and needs none of the app's plugins — JSX is all it has to compile.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  // the server package runs its own
  test: { include: ['src/**/*.test.{ts,tsx}'] },
})
