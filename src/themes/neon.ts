import type { Theme } from './types'

// Placeholder — sane, unpolished. Dark, saturated, glowing selection, heavy tracking.
export const neon: Theme = {
  id: 'neon',
  name: 'Neon',

  canvasBg: '#0D0326',
  chromeBg: '#150538',
  chromeBorder: '#3D1180',

  textPrimary: '#F3EBFF',
  textMuted: '#A190C9',
  fontDisplay: 'system-ui, sans-serif',
  fontUi: 'system-ui, sans-serif',
  displayTransform: 'uppercase',
  displayTracking: '4px',

  layerBorderColor: null,
  layerBorderWidth: 0,
  // a glow, not a drop shadow
  layerShadowColor: 'rgba(255,43,214,0.75)',
  layerShadowBlur: 14,
  layerShadowOffset: { x: 0, y: 0 },
  layerJitterDegrees: 0,
  selectionColor: '#22F0FF',

  buttonRadius: 20,
  buttonJitterDegrees: 0,
  primaryBg: '#FF2BD6',
  primaryText: '#0D0326',

  revealBg: '#07011A',
  revealFilter: 'saturate(1.4) contrast(1.05)',
  revealLetterbox: false,

  pageBg: '#07011A',
  surface: '#22094F',
  scrim: 'rgba(7,1,26,0.7)',
  danger: '#FF4D6D',
  dangerText: '#0D0326',
  warning: '#FFD60A',
  warningText: '#0D0326',
  accent: '#FFD60A',

  // an arcade after hours: everything lit from inside
  gallery: {
    wall: '#07011A',
    wallText: '#F3EBFF',
    placardBg: '#22094F',
    placardText: '#F3EBFF',
    placardMuted: '#B9A6E0',
    placardBorder: '1px solid #22F0FF',
    placardArtistFont: 'system-ui, sans-serif',
    placardTitleFont: "Georgia, 'Times New Roman', serif",
    frame: '0 0 0 2px #22F0FF, 0 0 18px rgba(34,240,255,0.45)',
    winnerFrame: '0 0 0 3px #FFD60A, 0 0 0 9px #22094F, 0 0 0 11px #FFD60A, 0 0 30px rgba(255,214,10,0.6)',
    ribbons: {
      best: { face: '#FFD60A', edge: '#FF2E88', ink: '#07011A' },
      second: { face: '#22F0FF', edge: '#22094F', ink: '#07011A' },
      divisive: { face: '#FF2E88', edge: '#FFD60A', ink: '#07011A' },
      everybodysSecond: { face: '#7CFF6B', edge: '#22094F', ink: '#07011A' },
      honourable: { face: '#B388FF', edge: '#22094F', ink: '#07011A' },
    },
  },
}
