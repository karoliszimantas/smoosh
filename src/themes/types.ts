// Every visual decision in the app comes from the active theme: plain CSS
// reads it as custom properties (see cssVars), the Konva canvas reads it
// through useTheme(). Nothing outside src/themes/ hardcodes a colour,
// shadow, radius or font.
//
// Sizes for things drawn on the canvas (layer border, shadow) are in screen
// pixels on a 400px-wide frame — they scale with the frame, so a picture
// looks the same on a big screen and in the 1024px export.
export type Theme = {
  id: string
  name: string

  // surfaces
  canvasBg: string
  chromeBg: string
  chromeBorder: string

  // text
  textPrimary: string
  textMuted: string
  fontDisplay: string // prompt bar, titles
  fontUi: string
  displayTransform: 'uppercase' | 'none'
  displayTracking: string

  // layers on canvas
  layerShadowColor: string
  // whether a cut-out (any layer with transparency) gets the shadow too. A
  // soft drop shadow reads as depth, so it does; a glow traces the cut's
  // edge into a coloured halo, so it doesn't — only rectangular layers,
  // where it reads as a frame
  cutoutShadow: boolean
  layerShadowBlur: number
  layerShadowOffset: { x: number; y: number }
  selectionColor: string

  // controls
  buttonRadius: number
  primaryBg: string
  primaryText: string

  // reveal phase
  revealBg: string
  revealFilter: string | null // CSS filter applied to submissions

  // ---- beyond the core set: what the rest of the UI needs so that nothing
  // outside themes/ has to pick a colour of its own
  pageBg: string // behind everything — around the frame, behind full-page views
  surface: string // chips, cards, inputs, list rows, neutral buttons; textPrimary sits on it
  scrim: string // backdrop behind dialogs and the asset sheet
  danger: string // delete, errors
  dangerOnDesk: string // error text straight on the desk; danger is a fill
  dangerText: string // text on danger
  warning: string // a running-out timer, the reconnect banner
  warningText: string // text on warning
  accent: string // the winner, points — a fill; as text on paper use primaryInk

  // ---- paper on a desk: every surface is paper, and textPrimary/textMuted
  // are text on the desk (pageBg). What sits on paper reads these instead
  surfaceText: string // ink on surface
  surfaceTextMuted: string
  surfaceSunken: string // disabled controls, the fuse track, an empty seat, your own lie
  surfaceSunkenText: string
  line: string // ink borders on paper controls
  primaryInk: string // the primary red as text or stroke on paper
  successInk: string
  successTint: string // a done or used chip
  picked: string // a picked option, your score row
  focus: string // the selected layer chip, the focus ring on the desk
  // the focus ring on a control inside paper (a card, the toolbar, a sheet,
  // a dialog): drawn against the paper, not the desk, so it needs its own
  // colour where the desk's ring is pale (paper containers set --focus to it)
  focusOnPaper: string
  ghost: string // a pending player's dashed avatar
  awayChip: string // a player who's stepped away
  fontLabel: string // typewriter labels, set in caps
  labelTracking: string

  // hard offset shadows, or soft ones. card and small are plain
  // `x y blur colour` lists, valid as box-shadow and inside drop-shadow()
  shadow: {
    style: 'hard' | 'soft'
    card: string // paper cards
    small: string // chips, icon buttons
    ledge: string // a button standing on its ink ledge
    ledgeSmall: string
    ledgeInner: string // the ledge alone, for a button inside a card
    ledgePressed: string // :active — the button drops 3px onto a 2px ledge
    burst: string // the points burst on Reveal
  }

  paper: {
    torn: boolean // torn edges on the whitelisted cards (data-torn on <html>)
    tape: string | null // tape strips; null draws none
    dot: string | null // the desk's dot grid; null is a plain desk
    stamp: string // the REAL stamp
    dymo: { bg: string; text: string } // the embossed room-code label
  }

  // the timer tag hung on a string, with a fuse bar
  timer: {
    calm: string // the tag's paper and fuse
    hot: string // 10s or less
    track: string // the fuse's spent track while calm
    hotTrack: string // the fuse's spent track when hot
    string: string
    hazard: string // CSS background for the hot fuse's stripes
  }

  // seat colours, indexed by seat; fg is the initial on bg. Not CSS vars:
  // PlayerChip sets --p-bg/--p-fg inline
  players: readonly { bg: string; fg: string }[]
  markBadge: string // the white badge that carries a seat's shape
  promptChips: readonly string[] // the torn prompt-word chips, in turn
  // the six cut scraps of the ransom-note wordmark, s-m-o-o-s-h, each
  // lettered in ink (line). Fixed artwork: the same on every desk
  wordmark: readonly [string, string, string, string, string, string]
  // a sticker edge round cut-outs, in theme px on a 400px frame; null draws none
  stickerEdge: { color: string; width: number } | null
  motion: 'stepped' | 'smooth' // stepped = jittery stop-frame (data-motion on <html>)

  // Gallery's judging, played as an art prize: the pictures hang on a wall
  // with a museum label beside each, and prize-winners wear a fairground
  // rosette. Straight-faced in every theme — the joke is the contrast.
  gallery: {
    wall: string // behind the hung pictures
    wallText: string // headings and announcements on the wall
    placardBg: string // the wall label: a small typeset card
    placardText: string
    placardMuted: string
    placardBorder: string // 'none' or a CSS border
    placardArtistFont: string // the artist's name, set in caps
    placardTitleFont: string // the title, in italics
    // CSS box-shadow stacks: an ordinary frame, and the heavier one the
    // winner gets for its moment (gilt, or a deep museum mat)
    frame: string
    winnerFrame: string
    // per award: the rosette's pleats and tails, its centre, and the type on it
    ribbons: Record<'best' | 'second' | 'divisive' | 'everybodysSecond' | 'honourable', Ribbon>
  }
}

export type Ribbon = { face: string; edge: string; ink: string }
