import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import './themes/fonts.css'
import './index.css'
import App from './App.tsx'
import ThemeProvider from './themes/ThemeProvider'
import { applyThemeToDocument, initialTheme } from './themes'
import { redirectOldAdminPaths } from './admin/paths'
import { captureJoinFromUrl } from './game/invite'
import { prunePhotos } from './photos/photoStore'
import { defaultServices, GameServicesProvider, type GameServices } from './game/services'
import { startOps } from './ops/opsClient'

// /prompts and /labels, from before the admin area: on to /admin/… before
// anything renders
redirectOldAdminPaths()
// an invite, /?join=KRPT: kept for the home screen, and out of the address
// bar the same way
captureJoinFromUrl()
// photos left behind by a tab that crashed or was closed mid-game
void prunePhotos()
// how the game runs on this phone, for the server's log — from the start,
// so the page's own load is counted
startOps()

// before the first render, so the page never flashes the wrong theme
applyThemeToDocument(initialTheme())

function render(services: GameServices, DevPanel?: ComponentType): void {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ThemeProvider>
        <GameServicesProvider value={services}>
          <App />
          {DevPanel && <DevPanel />}
        </GameServicesProvider>
      </ThemeProvider>
    </StrictMode>,
  )
}

// Dev tools (src/dev) exist only in `vite dev` and in a `--mode devtools`
// build; the condition is a build-time constant, so a production build drops
// the import — and the whole src/dev chunk — entirely. In a devtools build
// they also need ?dev=1, so a plain visit to one behaves like production.
const DEVTOOLS_BUILT = import.meta.env.DEV || import.meta.env.MODE === 'devtools'

if (DEVTOOLS_BUILT && (import.meta.env.DEV || new URLSearchParams(location.search).has('dev'))) {
  void import('./dev/devTools').then(({ createDevTools }) => {
    const devTools = createDevTools()
    render(devTools.services, devTools.Panel)
  })
} else {
  render(defaultServices)
}
