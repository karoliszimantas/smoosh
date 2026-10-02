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

  layerBorderColor: null,
  layerBorderWidth: 0,
  layerShadowColor: 'rgba(0,0,0,0.16)',
  layerShadowBlur: 10,
  layerShadowOffset: { x: 0, y: 4 },
  layerJitterDegrees: 0,
  selectionColor: '#2563EB',

  buttonRadius: 12,
  buttonJitterDegrees: 0,
  primaryBg: '#2563EB',
  primaryText: '#FFFFFF',

  revealBg: '#E7E5E4',
  revealFilter: null,
  revealLetterbox: false,

  pageBg: '#E7E5E4',
  surface: '#FFFFFF',
  scrim: 'rgba(0,0,0,0.35)',
  danger: '#DC2626',
  dangerText: '#FFFFFF',
  warning: '#F59E0B',
  warningText: '#1C1917',
  accent: '#D97706',
}
