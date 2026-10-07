import type { Theme } from './types'
import { clean } from './clean'
import { neon } from './neon'

export type { Theme } from './types'

// Two themes: Clean, light, and Neon, dark. Which one is the device's own
// light/dark setting until the player picks — then theirs, remembered.
export const LIGHT: Theme = clean
export const DARK: Theme = neon
export const THEMES: readonly Theme[] = [LIGHT, DARK]
export const DEFAULT_THEME: Theme = LIGHT

export function themeById(id: string | null): Theme | undefined {
  return THEMES.find((t) => t.id === id)
}

// the device's light/dark setting
export function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? DARK : LIGHT
  } catch {
    return DEFAULT_THEME
  }
}

// what to show: the player's own pick if they've made one, else the device's
export function initialTheme(): Theme {
  return themeById(loadThemeId()) ?? systemTheme()
}

// The theme as CSS custom properties, for plain CSS to read. Set on the
// document root, so <html>/<body> and fixed overlays pick them up too.
export function cssVars(theme: Theme): Record<string, string> {
  return {
    '--canvas-bg': theme.canvasBg,
    '--chrome-bg': theme.chromeBg,
    '--chrome-border': theme.chromeBorder,
    '--chrome-text': theme.textPrimary,
    '--chrome-text-muted': theme.textMuted,
    '--chrome-danger': theme.danger,
    '--text': theme.textPrimary,
    '--text-muted': theme.textMuted,
    '--font-display': theme.fontDisplay,
    '--font-ui': theme.fontUi,
    '--display-transform': theme.displayTransform,
    '--display-tracking': theme.displayTracking,
    '--selection': theme.selectionColor,
    '--radius': `${theme.buttonRadius}px`,
    '--primary-bg': theme.primaryBg,
    '--primary-text': theme.primaryText,
    '--reveal-bg': theme.revealBg,
    '--reveal-filter': theme.revealFilter ?? 'none',
    '--page-bg': theme.pageBg,
    '--surface': theme.surface,
    '--scrim': theme.scrim,
    '--danger': theme.danger,
    '--danger-text': theme.dangerText,
    '--warning': theme.warning,
    '--warning-text': theme.warningText,
    '--accent': theme.accent,
    '--gallery-wall': theme.gallery.wall,
    '--gallery-wall-text': theme.gallery.wallText,
    '--placard-bg': theme.gallery.placardBg,
    '--placard-text': theme.gallery.placardText,
    '--placard-muted': theme.gallery.placardMuted,
    '--placard-border': theme.gallery.placardBorder,
    '--placard-artist-font': theme.gallery.placardArtistFont,
    '--placard-title-font': theme.gallery.placardTitleFont,
    '--frame': theme.gallery.frame,
    '--frame-winner': theme.gallery.winnerFrame,
    ...Object.fromEntries(
      Object.entries(theme.gallery.ribbons).flatMap(([award, r]) => [
        [`--ribbon-${award}-face`, r.face],
        [`--ribbon-${award}-edge`, r.edge],
        [`--ribbon-${award}-ink`, r.ink],
      ]),
    ),
  }
}

export function applyThemeToDocument(theme: Theme): void {
  const root = document.documentElement
  for (const [name, value] of Object.entries(cssVars(theme))) root.style.setProperty(name, value)
  root.dataset.theme = theme.id
}

const STORAGE_KEY = 'smoosh_theme'

// per player, per device — never sent over the socket. A stored pick that
// names no theme (one since removed: Scrapbook, Noir, Newsprint, Fresco) is
// no pick at all — forgotten, and the device's setting applies
export function loadThemeId(): string | null {
  try {
    const id = localStorage.getItem(STORAGE_KEY)
    if (id !== null && !themeById(id)) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return id
  } catch {
    return null
  }
}

export function saveThemeId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // best effort — the theme just won't be remembered
  }
}
