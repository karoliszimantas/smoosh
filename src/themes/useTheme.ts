import { useContext } from 'react'
import { ThemeContext, type ThemeContextValue } from './context'
import type { Theme } from './index'

export function useTheme(): Theme {
  return useContext(ThemeContext).theme
}

export function useThemeControl(): ThemeContextValue {
  return useContext(ThemeContext)
}
