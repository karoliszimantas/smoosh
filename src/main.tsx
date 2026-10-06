import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ThemeProvider from './themes/ThemeProvider'
import { applyThemeToDocument, loadThemeId, themeById } from './themes'
import { captureCodeFromUrl } from './prompts/access'
import { prunePhotos } from './photos/photoStore'
import { defaultServices, GameServicesProvider, type GameServices } from './game/services'

// a /prompts?code=… link: keep the code, and get it out of the address bar
// before anything renders
captureCodeFromUrl()
// photos left behind by a tab that crashed or was closed mid-game
void prunePhotos()

// before the first render, so the page never flashes the wrong theme
applyThemeToDocument(themeById(loadThemeId()))

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
