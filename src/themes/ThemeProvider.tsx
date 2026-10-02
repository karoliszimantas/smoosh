import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { ThemeContext } from './context'
import { applyThemeToDocument, loadThemeId, saveThemeId, themeById } from './index'

// The active theme lives here, above everything — switching only re-renders;
// nothing remounts, so the canvas keeps every layer exactly where it was.
export default function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState(() => themeById(loadThemeId()))

  useLayoutEffect(() => {
    applyThemeToDocument(theme)
  }, [theme])

  const setThemeId = useCallback((id: string) => {
    const next = themeById(id)
    saveThemeId(next.id)
    setTheme(next)
  }, [])

  const value = useMemo(() => ({ theme, setThemeId }), [theme, setThemeId])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
