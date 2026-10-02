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
}
