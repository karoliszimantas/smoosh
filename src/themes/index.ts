import type { Theme } from './types'
import { day } from './day'
import { night } from './night'

export type { Theme } from './types'

// Two themes, one scrapbook on two desks: Day, light, and Night, dark. Which
// one is the device's own light/dark setting until the player picks — then
// theirs, remembered.
export const LIGHT: Theme = day
export const DARK: Theme = night
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
    '--danger-on-desk': theme.dangerOnDesk,
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

    // paper on the desk. --text/--text-muted above are text on the desk;
    // anything on --surface reads --surface-text
    '--surface-text': theme.surfaceText,
    '--surface-text-muted': theme.surfaceTextMuted,
    '--surface-sunken': theme.surfaceSunken,
    '--surface-sunken-text': theme.surfaceSunkenText,
    '--line': theme.line,
    '--primary-ink': theme.primaryInk,
    '--success-ink': theme.successInk,
    '--success-tint': theme.successTint,
    '--picked': theme.picked,
    '--focus': theme.focus,
    '--focus-on-paper': theme.focusOnPaper,
    '--ghost': theme.ghost,
    '--away-chip': theme.awayChip,
    '--mark-badge': theme.markBadge,
    '--font-label': theme.fontLabel,
    '--label-tracking': theme.labelTracking,
    '--shadow': theme.shadow.card,
    '--shadow-sm': theme.shadow.small,
    '--ledge': theme.shadow.ledge,
    '--ledge-sm': theme.shadow.ledgeSmall,
    '--ledge-inner': theme.shadow.ledgeInner,
    '--ledge-pressed': theme.shadow.ledgePressed,
    '--burst-shadow': theme.shadow.burst,
    '--burst-figure': theme.burstFigure,
    '--burst-figure-shadow': theme.burstFigureShadow,
    '--tape': theme.paper.tape ?? 'transparent',
    '--dot': theme.paper.dot ?? 'transparent',
    '--stamp': theme.paper.stamp,
    '--dymo-bg': theme.paper.dymo.bg,
    '--dymo-text': theme.paper.dymo.text,
    // the die-cut rim round cut-outs (drawn on the canvas; this is for any
    // CSS that shows a cut-out the same way)
    '--sticker-edge': theme.stickerEdge?.color ?? 'transparent',
    '--timer-calm': theme.timer.calm,
    '--timer-hot': theme.timer.hot,
    '--timer-track': theme.timer.track,
    '--timer-hot-track': theme.timer.hotTrack,
    '--timer-string': theme.timer.string,
    '--hazard': theme.timer.hazard,
    ...Object.fromEntries(theme.promptChips.map((c, i) => [`--prompt-chip-${i}`, c])),
    ...Object.fromEntries(theme.wordmark.map((c, i) => [`--wordmark-${i}`, c])),
    // one frame of stepped motion: ~12fps, the stop-frame look. 0ms when
    // smooth, so a `steps()` timing built on it collapses to nothing
    '--step-ms': theme.motion === 'stepped' ? '83ms' : '0ms',
    '--torn-a': TORN_A,
    '--torn-b': TORN_B,
  }
}

// Torn paper edges, as clip-path polygons: a rough top and bottom, straight
// sides. Two, so neighbouring cards don't tear alike. The same in every
// theme — a theme without torn edges just never applies them (data-torn).
export const TORN_A =
  'polygon(0% 3px,6% 0px,12% 4px,18% 1px,24% 6px,30% 2px,36% 0px,42% 5px,48% 2px,54% 6px,60% 1px,66% 4px,72% 0px,78% 5px,84% 2px,90% 6px,96% 1px,100% 4px,100% calc(100% - 2px),96% calc(100% - 6px),90% calc(100% - 1px),84% calc(100% - 4px),78% 100%,72% calc(100% - 5px),66% calc(100% - 2px),60% calc(100% - 6px),54% calc(100% - 1px),48% calc(100% - 4px),42% 100%,36% calc(100% - 5px),30% calc(100% - 3px),24% calc(100% - 6px),18% calc(100% - 1px),12% calc(100% - 4px),6% calc(100% - 2px),0% calc(100% - 5px))'
export const TORN_B =
  'polygon(0% 1px,6% 5px,12% 2px,18% 6px,24% 0px,30% 4px,36% 3px,42% 0px,48% 5px,54% 1px,60% 4px,66% 6px,72% 2px,78% 0px,84% 5px,90% 1px,96% 4px,100% 2px,100% calc(100% - 5px),96% calc(100% - 1px),90% calc(100% - 4px),84% calc(100% - 6px),78% calc(100% - 2px),72% 100%,66% calc(100% - 3px),60% calc(100% - 5px),54% calc(100% - 1px),48% calc(100% - 6px),42% calc(100% - 2px),36% calc(100% - 4px),30% 100%,24% calc(100% - 5px),18% calc(100% - 2px),12% calc(100% - 6px),6% calc(100% - 1px),0% calc(100% - 3px))'

// CSS can't branch on a custom property's value, so the two switches that
// change which rules apply go on <html> as attributes: data-motion
// (stepped|smooth) and data-torn (true|false — also the escape hatch for
// slow devices)
export function applyThemeToDocument(theme: Theme): void {
  const root = document.documentElement
  for (const [name, value] of Object.entries(cssVars(theme))) root.style.setProperty(name, value)
  root.dataset.theme = theme.id
  root.dataset.motion = theme.motion
  root.dataset.torn = String(theme.paper.torn)
}

const STORAGE_KEY = 'smoosh_theme'

// Themes that were renamed: a stored pick of one carries over to its
// successor, light for light and dark for dark
const RENAMED: Record<string, string> = { clean: 'day', neon: 'night' }

// per player, per device — never sent over the socket. A stored pick that
// names no theme (one since removed: Scrapbook, Noir, Newsprint, Fresco) is
// no pick at all — forgotten, and the device's setting applies
export function loadThemeId(): string | null {
  try {
    let id = localStorage.getItem(STORAGE_KEY)
    const renamed = id !== null && Object.hasOwn(RENAMED, id) ? RENAMED[id] : undefined
    if (renamed !== undefined) {
      localStorage.setItem(STORAGE_KEY, renamed)
      id = renamed
    }
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
