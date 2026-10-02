import type { Theme } from './types'

// Plaster grain: sparse light and dark specks, tiled over the canvas. Drawn
// to a tiny PNG (~1KB) for the same reason as Newsprint's halftone — an SVG
// drawn into a canvas can block the export in some browsers (Safari).
function plaster(): string | undefined {
  try {
    const size = 48
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const ctx = c.getContext('2d')
    if (!ctx) return undefined
    // fixed seed: the same wall every time
    let seed = 7
    const rand = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    for (let i = 0; i < 140; i++) {
      const dark = rand() < 0.55
      ctx.fillStyle = dark ? `rgba(60,25,10,${0.05 + rand() * 0.08})` : `rgba(255,240,220,${0.05 + rand() * 0.1})`
      ctx.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), rand() < 0.2 ? 2 : 1, 1)
    }
    return c.toDataURL('image/png')
  } catch {
    return undefined
  }
}
const PLASTER = plaster()

// Greek vase painting and Minoan fresco: terracotta ground, figures as flat
// silhouettes with a painted contour, a meander band round the edge.
// Deliberately the opposite of Scrapbook — composed, aligned, no jitter:
// a fresco is IN the wall, not lying on a desk, so almost no shadow.
export const fresco: Theme = {
  id: 'fresco',
  name: 'Fresco',

  canvasBg: '#C97B4A', // terracotta ground
  ...(PLASTER ? { canvasTexture: PLASTER } : {}),
  canvasFrame: { pattern: 'meander', color: '#2A1710', width: 14 },
  chromeBg: '#8C4A2F', // darker fired clay
  chromeBorder: '#5C2E1C',
  // textPrimary on the fired clay is ~2.5:1 — unreadable for the prompt.
  // Bone white on it is ~5.6:1
  chromeText: '#F4E6CF',

  textPrimary: '#2A1710',
  textMuted: '#8C6A52',
  fontDisplay: "'Cinzel', Georgia, serif",
  fontUi: 'system-ui, sans-serif',
  displayTransform: 'uppercase',
  displayTracking: '3px',

  layerBorderColor: '#2A1710', // dark outline, like a painted contour
  layerBorderWidth: 2,
  layerShadowColor: 'rgba(42,23,16,0.12)',
  layerShadowBlur: 3,
  layerShadowOffset: { x: 0, y: 1 },
  layerJitterDegrees: 0,
  selectionColor: '#E8C170', // gold

  buttonRadius: 0,
  buttonJitterDegrees: 0,
  primaryBg: '#2A1710',
  primaryText: '#E8C170',

  revealBg: '#1A0E08',
  revealFilter: 'sepia(0.45) contrast(1.15) saturate(1.2) hue-rotate(-8deg)',
  revealLetterbox: true,

  // ochre plaster: light enough for textPrimary (and textMuted) to read on
  pageBg: '#E6C9A3',
  surface: '#F4E6CF',
  scrim: 'rgba(42,23,16,0.5)',
  danger: '#9E2B1E',
  dangerText: '#F4E6CF',
  warning: '#E8C170',
  warningText: '#2A1710',
  accent: '#9E2B1E',
}
