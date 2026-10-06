import type { Theme } from './types'

// A faint halftone dot screen, tiled over the canvas. Drawn to a PNG rather
// than written as an SVG data-URI: some browsers (Safari) treat an SVG
// drawn into a canvas as cross-origin and refuse to export the canvas after.
function halftone(): string | undefined {
  try {
    const c = document.createElement('canvas')
    c.width = 12
    c.height = 12
    const ctx = c.getContext('2d')
    if (!ctx) return undefined
    ctx.fillStyle = 'rgba(0,0,0,0.10)'
    for (const [x, y] of [
      [3, 3],
      [9, 9],
    ] as const) {
      ctx.beginPath()
      ctx.arc(x, y, 1.3, 0, Math.PI * 2)
      ctx.fill()
    }
    return c.toDataURL('image/png')
  } catch {
    return undefined
  }
}
const HALFTONE = halftone()

// Placeholder — sane, unpolished. Off-white, halftone-ish, condensed type, black rules.
export const newsprint: Theme = {
  id: 'newsprint',
  name: 'Newsprint',

  canvasBg: '#F2EFE6',
  ...(HALFTONE ? { canvasTexture: HALFTONE } : {}),
  chromeBg: '#E8E4D8',
  chromeBorder: '#1A1A1A',

  textPrimary: '#111111',
  textMuted: '#5E5B54',
  fontDisplay: "'Oswald', 'Arial Narrow', sans-serif",
  fontUi: 'system-ui, sans-serif',
  displayTransform: 'uppercase',
  displayTracking: '0.5px',

  layerBorderColor: '#111111',
  layerBorderWidth: 1,
  layerShadowColor: 'rgba(0,0,0,0)',
  layerShadowBlur: 0,
  layerShadowOffset: { x: 0, y: 0 },
  layerJitterDegrees: 2,
  selectionColor: '#D62828',

  buttonRadius: 0,
  buttonJitterDegrees: 0,
  primaryBg: '#111111',
  primaryText: '#F2EFE6',

  revealBg: '#111111',
  revealFilter: 'grayscale(1) contrast(1.2)',
  revealLetterbox: false,

  pageBg: '#DAD5C7',
  surface: '#F2EFE6',
  scrim: 'rgba(17,17,17,0.45)',
  danger: '#D62828',
  dangerText: '#F2EFE6',
  warning: '#E9B949',
  warningText: '#111111',
  accent: '#D62828',

  // the arts page: ruled boxes, ink rosettes, a red one for the winner
  gallery: {
    wall: '#DAD5C7',
    wallText: '#111111',
    placardBg: '#F2EFE6',
    placardText: '#111111',
    placardMuted: '#5E5B54',
    placardBorder: '1px solid #111111',
    placardArtistFont: "'Oswald', 'Arial Narrow', sans-serif",
    placardTitleFont: "Georgia, 'Times New Roman', serif",
    frame: '0 0 0 1px #111111, 0 0 0 5px #F2EFE6, 0 0 0 6px #111111',
    winnerFrame: '0 0 0 2px #111111, 0 0 0 9px #F2EFE6, 0 0 0 12px #111111',
    ribbons: {
      best: { face: '#D62828', edge: '#111111', ink: '#F2EFE6' },
      second: { face: '#111111', edge: '#5E5B54', ink: '#F2EFE6' },
      divisive: { face: '#5E5B54', edge: '#111111', ink: '#F2EFE6' },
      everybodysSecond: { face: '#E9B949', edge: '#111111', ink: '#111111' },
      honourable: { face: '#F2EFE6', edge: '#111111', ink: '#111111' },
    },
  },
}
