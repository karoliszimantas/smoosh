import type { Theme } from './types'

// Placeholder — sane, unpolished. Near-black, white hairline borders, no jitter.
export const noir: Theme = {
  id: 'noir',
  name: 'Noir',

  canvasBg: '#141414',
  chromeBg: '#0A0A0A',
  chromeBorder: '#2E2E2E',

  textPrimary: '#F2F2F2',
  textMuted: '#8C8C8C',
  fontDisplay: "Georgia, 'Times New Roman', serif",
  fontUi: 'system-ui, sans-serif',
  displayTransform: 'uppercase',
  displayTracking: '3px',

  layerBorderColor: '#F2F2F2',
  layerBorderWidth: 1,
  layerShadowColor: 'rgba(0,0,0,0.7)',
  layerShadowBlur: 12,
  layerShadowOffset: { x: 0, y: 4 },
  layerJitterDegrees: 0,
  selectionColor: '#F2F2F2',

  buttonRadius: 0,
  buttonJitterDegrees: 0,
  primaryBg: '#F2F2F2',
  primaryText: '#0A0A0A',

  revealBg: '#000000',
  revealFilter: 'grayscale(1) contrast(1.15)',
  revealLetterbox: true,

  pageBg: '#000000',
  surface: '#1C1C1C',
  scrim: 'rgba(0,0,0,0.7)',
  danger: '#F87171',
  dangerText: '#0A0A0A',
  warning: '#FBBF24',
  warningText: '#0A0A0A',
  accent: '#F2F2F2',

  // a black room, a single light on each work, white cards
  gallery: {
    wall: '#0A0A0A',
    wallText: '#F2F2F2',
    placardBg: '#F2F2F2',
    placardText: '#0A0A0A',
    placardMuted: '#555555',
    placardBorder: 'none',
    placardArtistFont: "Georgia, 'Times New Roman', serif",
    placardTitleFont: "Georgia, 'Times New Roman', serif",
    frame: '0 0 0 1px #F2F2F2, 0 10px 30px rgba(0,0,0,0.8)',
    winnerFrame: '0 0 0 14px #F2F2F2, 0 0 0 15px #8C8C8C, 0 14px 40px rgba(0,0,0,0.9)',
    ribbons: {
      best: { face: '#F2F2F2', edge: '#8C8C8C', ink: '#0A0A0A' },
      second: { face: '#BDBDBD', edge: '#F2F2F2', ink: '#0A0A0A' },
      divisive: { face: '#1C1C1C', edge: '#F2F2F2', ink: '#F2F2F2' },
      everybodysSecond: { face: '#7A7A7A', edge: '#D0D0D0', ink: '#0A0A0A' },
      honourable: { face: '#3A3A3A', edge: '#9A9A9A', ink: '#F2F2F2' },
    },
  },
}
