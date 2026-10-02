import { createContext } from 'react'
import { DEFAULT_THEME, type Theme } from './index'

export type ThemeContextValue = { theme: Theme; setThemeId: (id: string) => void }

export const ThemeContext = createContext<ThemeContextValue>({ theme: DEFAULT_THEME, setThemeId: () => {} })
