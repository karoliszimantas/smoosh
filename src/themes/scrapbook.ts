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
  // a village show in a church hall: kraft board, white-bordered prints,

  // rosettes in the fairground colours
  gallery: {
    wall: '#C9BC9E',
    wallText: '#1C1A16',
    placardBg: '#FBF7EE',
    placardText: '#1C1A16',
    placardMuted: '#6E675C',
    placardBorder: 'none',
    placardArtistFont: "'Archivo Black', system-ui, sans-serif",
    placardTitleFont: "Georgia, 'Times New Roman', serif",
    frame: '0 0 0 5px #FBF7EE, 0 3px 10px rgba(40,34,24,0.35)',
    winnerFrame:
      '0 0 0 3px #6B4E16, 0 0 0 8px #C9A13B, 0 0 0 10px #8A6A1F, 0 0 0 12px #E2C46B, 0 8px 20px rgba(40,34,24,0.45)',
    ribbons: {
      best: { face: '#5B2A86', edge: '#D9A93B', ink: '#FBF7EE' },
      second: { face: '#1F4E9C', edge: '#9DB8E6', ink: '#FBF7EE' },
      divisive: { face: '#C8601C', edge: '#F2C08A', ink: '#FBF7EE' },
      everybodysSecond: { face: '#2E7D4F', edge: '#A9D8B8', ink: '#FBF7EE' },
      honourable: { face: '#EFE6CF', edge: '#B7A77F', ink: '#1C1A16' },
    },
  },
}
