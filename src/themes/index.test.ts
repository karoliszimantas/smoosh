import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { applyThemeToDocument, cssVars, DARK, DEFAULT_THEME, LIGHT, loadThemeId, THEMES } from './index'

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
    '--focus-on-paper',
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
    '--burst-figure',
    '--burst-figure-shadow',
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
