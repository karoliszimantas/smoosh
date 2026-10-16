import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { applyThemeToDocument, cssVars, DARK, DEFAULT_THEME, LIGHT, loadThemeId, THEMES } from './index'
import type { Theme } from './types'

const KEY = 'smoosh_theme'

// a Map behind the Storage interface — node has no localStorage
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the two themes', () => {
  it('is Day for light, Night for dark, Day by default', () => {
    expect(LIGHT.id).toBe('day')
    expect(DARK.id).toBe('night')
    expect(DEFAULT_THEME).toBe(LIGHT)
    expect(THEMES.map((t) => t.id)).toEqual(['day', 'night'])
  })

  it('draws every submitted picture on the same paper', () => {
    expect(LIGHT.canvasBg).toBe(DARK.canvasBg)
    expect(LIGHT.revealBg).toBe(DARK.revealBg)
  })
})

describe('stored theme pick', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
  })

  it('carries Clean over to Day and rewrites the stored pick', () => {
    localStorage.setItem(KEY, 'clean')
    expect(loadThemeId()).toBe('day')
    expect(localStorage.getItem(KEY)).toBe('day')
  })

  it('carries Neon over to Night and rewrites the stored pick', () => {
    localStorage.setItem(KEY, 'neon')
    expect(loadThemeId()).toBe('night')
    expect(localStorage.getItem(KEY)).toBe('night')
  })

  it('forgets a pick that names no theme', () => {
    localStorage.setItem(KEY, 'scrapbook')
    expect(loadThemeId()).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('keeps a current pick, and no pick is no pick', () => {
    expect(loadThemeId()).toBeNull()
    localStorage.setItem(KEY, 'night')
    expect(loadThemeId()).toBe('night')
  })
})

describe('cssVars', () => {
  const NEW_VARS = [
    '--surface-text',
    '--surface-text-muted',
    '--surface-sunken',
    '--surface-sunken-text',
    '--line',
    '--primary-ink',
    '--success-ink',
    '--success-tint',
    '--picked',
    '--focus',
    '--ghost',
    '--away-chip',
    '--mark-badge',
    '--font-label',
    '--label-tracking',
    '--shadow',
    '--shadow-sm',
    '--ledge',
    '--ledge-sm',
    '--ledge-inner',
    '--ledge-pressed',
    '--burst-shadow',
    '--tape',
    '--dot',
    '--stamp',
    '--dymo-bg',
    '--dymo-text',
    '--sticker-edge',
    '--timer-calm',
    '--timer-hot',
    '--timer-track',
    '--timer-hot-track',
    '--timer-string',
    '--hazard',
    '--prompt-chip-0',
    '--prompt-chip-1',
    '--prompt-chip-2',
    '--step-ms',
    '--torn-a',
    '--torn-b',
  ]

  it.each(THEMES.map((t) => [t.id, t] as const))('%s sets every paper var', (_, theme) => {
    const vars = cssVars(theme)
    for (const name of NEW_VARS) expect(vars[name], name).toBeTruthy()
    expect(vars['--torn-a']).toMatch(/^polygon\(/)
    expect(vars['--surface-text']).toBe(theme.surfaceText)
  })

  it('gives the sticker edge its colour, and none when a theme has no edge', () => {
    expect(cssVars(DARK)['--sticker-edge']).toBe('#FFFFFF')
    expect(cssVars(LIGHT)['--sticker-edge']).toBe('#FBF7EE')
    expect(cssVars({ ...DARK, stickerEdge: null })['--sticker-edge']).toBe('transparent')
  })

  it('keeps --frame for the gallery and never claims --ink', () => {
    const vars = cssVars(DARK)
    expect(vars['--frame']).toBe(DARK.gallery.frame)
    expect(vars).not.toHaveProperty('--ink')
  })
})

describe('applyThemeToDocument', () => {
  it('sets the theme, motion and torn switches on <html>', () => {
    const props = new Map<string, string>()
    const root = { style: { setProperty: (k: string, v: string) => props.set(k, v) }, dataset: {} as DOMStringMap }
    vi.stubGlobal('document', { documentElement: root })

    applyThemeToDocument(DARK)
    expect(root.dataset).toMatchObject({ theme: 'night', motion: 'stepped', torn: 'true' })
    expect(props.get('--surface')).toBe(DARK.surface)

    applyThemeToDocument({ ...LIGHT, motion: 'smooth', paper: { ...LIGHT.paper, torn: false } })
    expect(root.dataset).toMatchObject({ theme: 'day', motion: 'smooth', torn: 'false' })
    expect(props.get('--step-ms')).toBe('0ms')
  })
})

// WCAG 2 contrast ratio between two opaque #RRGGBB colours
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}
function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

describe('text contrast', () => {
  const PAIRS: [string, (t: Theme) => [string, string]][] = [
    ['ink on paper', (t) => [t.surfaceText, t.surface]],
    ['muted ink on paper', (t) => [t.surfaceTextMuted, t.surface]],
    ['text on the desk', (t) => [t.textPrimary, t.pageBg]],
    ['muted text on the desk', (t) => [t.textMuted, t.pageBg]],
    ['primary button', (t) => [t.primaryText, t.primaryBg]],
    ['red on paper', (t) => [t.primaryInk, t.surface]],
    ['disabled', (t) => [t.surfaceSunkenText, t.surfaceSunken]],
    ['danger', (t) => [t.dangerText, t.danger]],
    ['error text on the desk', (t) => [t.dangerOnDesk, t.pageBg]],
    ['warning', (t) => [t.warningText, t.warning]],
    ['a seat badge’s shape', (t) => [t.line, t.markBadge]],
    ['the timer’s digits', (t) => [t.surfaceText, t.timer.calm]],
    ['the timer’s digits, last 10 seconds', (t) => [t.line, t.timer.hot]],
    ['the room code’s label', (t) => [t.paper.dymo.text, t.paper.dymo.bg]],
  ]

  for (const theme of THEMES) {
    it.each(PAIRS)(`${theme.id}: %s is at least 4.5:1`, (_, pair) => {
      const [fg, bg] = pair(theme)
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5)
    })
  }

  // the wordmark's ink letters on their scraps: a logotype, so exempt, but
  // it holds to the same floor as everything else
  for (const theme of THEMES) {
    it.each(theme.wordmark.map((c, i) => [i, c] as const))(`${theme.id}: wordmark scrap %i is at least 4.5:1`, (_, c) => {
      expect(contrast(theme.line, c)).toBeGreaterThanOrEqual(4.5)
    })
  }

  // the initial on each seat's avatar
  for (const theme of THEMES) {
    it.each(theme.players.map((p, i) => [i, p] as const))(`${theme.id}: seat %i's initial is at least 4.5:1`, (_, p) => {
      expect(contrast(p.fg, p.bg)).toBeGreaterThanOrEqual(4.5)
    })
  }
})
