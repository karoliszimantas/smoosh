import type { Theme } from './types'

// Placeholder — sane, unpolished. White, no borders, no jitter, soft shadows.
export const clean: Theme = {
  id: 'clean',
  name: 'Clean',

  canvasBg: '#FFFFFF',
  chromeBg: '#F5F5F4',
  chromeBorder: '#E7E5E4',

  textPrimary: '#1C1917',
  textMuted: '#78716C',
  fontDisplay: 'system-ui, sans-serif',
  fontUi: 'system-ui, sans-serif',
  displayTransform: 'none',
  displayTracking: '0px',

  cutoutShadow: true,
  layerShadowColor: 'rgba(0,0,0,0.16)',
  layerShadowBlur: 10,
  layerShadowOffset: { x: 0, y: 4 },
  selectionColor: '#2563EB',

  buttonRadius: 12,
  primaryBg: '#2563EB',
  primaryText: '#FFFFFF',

  revealBg: '#E7E5E4',
  revealFilter: null,

  pageBg: '#E7E5E4',
  surface: '#FFFFFF',
  scrim: 'rgba(0,0,0,0.35)',
  danger: '#DC2626',
  dangerText: '#FFFFFF',
  warning: '#F59E0B',
  warningText: '#1C1917',
  accent: '#D97706',

  // a white-cube gallery: white wall, white mat, nothing to look at but the work
  gallery: {
    wall: '#F5F5F4',
    wallText: '#1C1917',
    placardBg: '#FFFFFF',
    placardText: '#1C1917',
    placardMuted: '#6B6560',
    placardBorder: '1px solid #E7E5E4',
    placardArtistFont: 'system-ui, sans-serif',
    placardTitleFont: "Georgia, 'Times New Roman', serif",
    frame: '0 0 0 1px #D6D3D1, 0 2px 8px rgba(28,25,23,0.12)',
    winnerFrame: '0 0 0 14px #FFFFFF, 0 0 0 15px #D6D3D1, 0 10px 28px rgba(28,25,23,0.22)',
    ribbons: {
      best: { face: '#B45309', edge: '#FCD34D', ink: '#FFFFFF' },
      second: { face: '#1D4ED8', edge: '#93C5FD', ink: '#FFFFFF' },
      divisive: { face: '#B91C1C', edge: '#FCA5A5', ink: '#FFFFFF' },
      everybodysSecond: { face: '#047857', edge: '#6EE7B7', ink: '#FFFFFF' },
      honourable: { face: '#F5F5F4', edge: '#A8A29E', ink: '#1C1917' },
    },
  },
}
