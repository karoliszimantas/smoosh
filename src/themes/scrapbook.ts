import type { Theme } from './types'

// Every layer is a scrap of paper with a white torn edge, lying on a desk
// with a shadow under it. Nothing is quite square — layers land a few
// degrees off, even the buttons. Warm card stock, not grey UI. Heavy caps,
// because the content is stupid and the delivery should be serious.
export const scrapbook: Theme = {
  id: 'scrapbook',
  name: 'Scrapbook',

  canvasBg: '#EFE9DC',
  chromeBg: '#DED6C4',
  chromeBorder: '#C9C0AC',

  textPrimary: '#1C1A16',
  textMuted: '#8A8276',
  fontDisplay: "'Archivo Black', system-ui, sans-serif",
  fontUi: 'system-ui, sans-serif',
  displayTransform: 'uppercase',
  displayTracking: '1.5px',

  layerBorderColor: '#FBF7EE',
  layerBorderWidth: 3,
  layerShadowColor: 'rgba(40,34,24,0.22)',
  layerShadowBlur: 7,
  layerShadowOffset: { x: 0, y: 3 },
  layerJitterDegrees: 12,
  selectionColor: '#4ADE80',

  buttonRadius: 0,
  buttonJitterDegrees: 1.2,
  primaryBg: '#1C1A16',
  primaryText: '#F2EDE1',

  revealBg: '#0A0A09',
  revealFilter: 'sepia(0.25) contrast(1.1) saturate(0.9)',
  revealLetterbox: true,

  // the desk the card stock sits on
  pageBg: '#D2C9B5',
  surface: '#F7F2E7',
  scrim: 'rgba(28,26,22,0.45)',
  danger: '#A8321F',
  dangerText: '#FBF7EE',
  warning: '#D9922B',
  warningText: '#1C1A16',
  // rust, like a rubber stamp — yellow stars vanish on cream paper
  accent: '#B8481C',
}
