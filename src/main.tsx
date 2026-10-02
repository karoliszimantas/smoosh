import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ThemeProvider from './themes/ThemeProvider'
import { applyThemeToDocument, loadThemeId, themeById } from './themes'

// before the first render, so the page never flashes the wrong theme
applyThemeToDocument(themeById(loadThemeId()))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
