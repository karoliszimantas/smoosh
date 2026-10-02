import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ThemeProvider from './themes/ThemeProvider'
import { applyThemeToDocument, loadThemeId, themeById } from './themes'
import { captureCodeFromUrl } from './prompts/access'

// a /prompts?code=… link: keep the code, and get it out of the address bar
// before anything renders
captureCodeFromUrl()

// before the first render, so the page never flashes the wrong theme
applyThemeToDocument(themeById(loadThemeId()))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
