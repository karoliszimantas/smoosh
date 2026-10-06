import type { Theme } from './types'
import { scrapbook } from './scrapbook'
import { clean } from './clean'
import { noir } from './noir'
import { neon } from './neon'
import { newsprint } from './newsprint'
import { fresco } from './fresco'

export type { Theme } from './types'

// switcher order — a new theme is a new file plus one line here
export const THEMES: readonly Theme[] = [scrapbook, clean, noir, neon, newsprint, fresco]

export const DEFAULT_THEME: Theme = scrapbook

export function themeById(id: string | null): Theme {
  return THEMES.find((t) => t.id === id) ?? DEFAULT_THEME
}

// The theme as CSS custom properties, for plain CSS to read. Set on the
// document root, so <html>/<body> and fixed overlays pick them up too.
export function cssVars(theme: Theme): Record<string, string> {
  return {
    '--canvas-bg': theme.canvasBg,
    '--chrome-bg': theme.chromeBg,
    '--chrome-border': theme.chromeBorder,
    // text on the chrome. A theme without its own chromeText keeps exactly
    // the colours it always had: textPrimary, textMuted, danger
    '--chrome-text': theme.chromeText ?? theme.textPrimary,
    '--chrome-text-muted': theme.chromeText
      ? `color-mix(in srgb, ${theme.chromeText} 62%, ${theme.chromeBg})`
      : theme.textMuted,
    '--chrome-danger': theme.chromeText ?? theme.danger,
    '--text': theme.textPrimary,
    '--text-muted': theme.textMuted,
    '--font-display': theme.fontDisplay,
    '--font-ui': theme.fontUi,
    '--display-transform': theme.displayTransform,
    '--display-tracking': theme.displayTracking,
    '--selection': theme.selectionColor,
    '--radius': `${theme.buttonRadius}px`,
    '--jitter': `${theme.buttonJitterDegrees}deg`,
    '--primary-bg': theme.primaryBg,
    '--primary-text': theme.primaryText,
    '--reveal-bg': theme.revealBg,
    '--reveal-filter': theme.revealFilter ?? 'none',
    // letterboxed: the picture sits in a full-width band with bars above and below
    '--reveal-letterbox': theme.revealLetterbox ? '28px' : '0px',
    '--reveal-width': theme.revealLetterbox ? '100vw' : 'var(--picture-size)',
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

// per player, per device — never sent over the socket
export function loadThemeId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
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
