import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { ThemeContext } from './context'
import { applyThemeToDocument, initialTheme, loadThemeId, saveThemeId, systemTheme, themeById } from './index'

// The active theme lives here, above everything — switching only re-renders;
// nothing remounts, so the canvas keeps every layer exactly where it was.
// Until the player picks, it follows the device's light/dark setting, live.
export default function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState(initialTheme)

  useLayoutEffect(() => {
    applyThemeToDocument(theme)
  }, [theme])

  useEffect(() => {
    let query: MediaQueryList
    try {
      query = window.matchMedia('(prefers-color-scheme: dark)')
    } catch {
      return
    }
    const follow = () => {
      if (loadThemeId() === null) setTheme(systemTheme())
    }
    query.addEventListener('change', follow)
    return () => query.removeEventListener('change', follow)
  }, [])

  const setThemeId = useCallback((id: string) => {
    const next = themeById(id)
    if (!next) return
    saveThemeId(next.id)
    setTheme(next)
  }, [])

  const value = useMemo(() => ({ theme, setThemeId }), [theme, setThemeId])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
