import type { Theme } from './types'

const INK = '#1A1714'
const PAPER = '#F4EDE0'
// the picture's own paper, the same in both themes: a submitted picture
// looks the same to every player whichever desk they're on
const PICTURE = '#FBF7EE'
const HARD = 'rgba(0,0,0,.55)'

const FONT_DISPLAY = "'Archivo Black', 'Archivo Black Fallback', 'Arial Black', Impact, sans-serif"
const FONT_UI = "'Archivo', 'Archivo Fallback', 'Helvetica Neue', Arial, sans-serif"
const FONT_LABEL = "'Courier Prime', 'Courier Prime Fallback', 'Courier New', monospace"

// A scrapbook on a dark desk: paper cut-outs and ink on a dot-grid desk at
// night, hard offset shadows, buttons standing on ink ledges.
export const night: Theme = {
  id: 'night',
  name: 'Night',

  canvasBg: PICTURE,
  chromeBg: INK,
  chromeBorder: '#5A5248', // legacy outline; paper cards use shadow.card

  // on the desk
  textPrimary: PAPER,
  textMuted: '#B3A895',
  fontDisplay: FONT_DISPLAY,
  fontUi: FONT_UI,
  displayTransform: 'none',
  displayTracking: '0px',

  cutoutShadow: true,
  layerShadowColor: 'rgba(0,0,0,.3)',
  layerShadowBlur: 10,
  layerShadowOffset: { x: 0, y: 6 },
  selectionColor: '#B8320A',

  buttonRadius: 4,
  primaryBg: '#FF5A1F',
  primaryText: INK,

  revealBg: PICTURE,
  revealFilter: null,

  pageBg: INK,
  surface: PAPER,
  scrim: 'rgba(20,18,16,.6)',
  danger: '#D7141A',
  dangerText: '#FFFFFF',
  warning: '#FFD84A',
  warningText: INK,
  accent: '#FFD84A',

  surfaceText: INK,
  surfaceTextMuted: '#5C5348',
  surfaceSunken: '#E9DFCC',
  surfaceSunkenText: '#5C5348',
  line: INK,
  primaryInk: '#B8320A',
  successInk: '#1B6F3E',
  successTint: '#E3F1E2',
  picked: '#FFD84A',
  focus: '#FFD84A',
  ghost: '#B3A895',
  awayChip: '#B3A895',
  fontLabel: FONT_LABEL,
  labelTracking: '1.5px',

  shadow: {
    style: 'hard',
    card: `3px 4px 0 ${HARD}`,
    small: `2px 3px 0 ${HARD}`,
    ledge: `0 5px 0 ${INK}, 3px 9px 0 ${HARD}`,
    ledgeSmall: `0 4px 0 ${INK}, 2px 7px 0 ${HARD}`,
    ledgeInner: `0 5px 0 ${INK}`,
    ledgePressed: `0 1px 0 ${INK}, 1px 2px 0 ${HARD}`,
    burst: '4px 5px 0 rgba(0,0,0,.6)',
  },

  paper: {
    torn: true,
    tape: '#FFD84A', // drawn at .85 opacity
    dot: 'rgba(244,237,224,.07)',
    stamp: '#D7141A',
    dymo: { bg: '#141210', text: '#FFFFFF' },
  },

  timer: {
    calm: PAPER,
    hot: '#FF5A1F',
    hotTrack: '#FFB291',
    string: '#8A7E6C',
    hazard: `repeating-linear-gradient(-45deg, ${INK} 0 5px, #FFD84A 5px 10px)`,
  },

  players: [
    { bg: '#0B7F5E', fg: '#FFFFFF' },
    { bg: '#3D8BFF', fg: INK },
    { bg: '#FFC93C', fg: INK },
    { bg: '#F59AD0', fg: INK },
    // provisional: the artboards draw four seats, a room seats eight
    { bg: '#FF5A1F', fg: INK },
    { bg: '#B3A895', fg: INK },
    { bg: '#8E6CFF', fg: INK },
    { bg: '#FFFFFF', fg: INK },
  ],
  promptChips: ['#FFD84A', '#3D8BFF', '#F59AD0'],
  stickerEdge: { color: '#FFFFFF', width: 3 },
  motion: 'stepped',

  // a paper museum on the desk: pictures matted in paper, labels typed on
  // paper, rosettes cut from the player and prompt colours
  gallery: {
    wall: INK,
    wallText: PAPER,
    placardBg: PAPER,
    placardText: INK,
    placardMuted: '#5C5348',
    placardBorder: 'none',
    placardArtistFont: FONT_LABEL,
    placardTitleFont: "Georgia, 'Times New Roman', serif",
    frame: `0 0 0 6px ${PAPER}, 3px 4px 0 6px ${HARD}`,
    winnerFrame: `0 0 0 6px #FFD84A, 0 0 0 8.5px ${INK}, 3px 4px 0 8.5px ${HARD}`,
    ribbons: {
      best: { face: '#FFD84A', edge: '#FF5A1F', ink: INK },
      second: { face: '#3D8BFF', edge: PAPER, ink: INK },
      divisive: { face: '#FF5A1F', edge: INK, ink: INK },
      everybodysSecond: { face: '#F59AD0', edge: '#3D8BFF', ink: INK },
      honourable: { face: '#0B7F5E', edge: PAPER, ink: '#FFFFFF' },
    },
  },
}
