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
  canvasTexture?: string // optional image (data-URI) tiled over canvasBg
  // a decorative border drawn on the canvas itself, inside the frame and
  // under the layers — so it's in the export, never covers a layer, and
  // doesn't move or shrink anything. Absent = { pattern: 'none' }.
  // `width` is the band's thickness in theme px (see top of file)
  canvasFrame?: {
    pattern: 'meander' | 'none'
    color: string
    width: number
  }
  chromeBg: string
  chromeBorder: string
  // text sitting directly on chromeBg (prompt bar, sheet, strip labels) —
  // for a theme whose chrome is too dark for textPrimary. Absent = textPrimary
  chromeText?: string

  // text
  textPrimary: string
  textMuted: string
  fontDisplay: string // prompt bar, titles
  fontUi: string
  displayTransform: 'uppercase' | 'none'
  displayTracking: string

  // layers on canvas
  layerBorderColor: string | null
  layerBorderWidth: number
  layerShadowColor: string
  layerShadowBlur: number
  layerShadowOffset: { x: number; y: number }
  layerJitterDegrees: number // 0 = no random rotation on placement
  selectionColor: string

  // controls
  buttonRadius: number
  buttonJitterDegrees: number
  primaryBg: string
  primaryText: string

  // reveal phase
  revealBg: string
  revealFilter: string | null // CSS filter applied to submissions
  revealLetterbox: boolean

  // ---- beyond the core set: what the rest of the UI needs so that nothing
  // outside themes/ has to pick a colour of its own
  pageBg: string // behind everything — around the frame, behind full-page views
  surface: string // chips, cards, inputs, list rows, neutral buttons; textPrimary sits on it
  scrim: string // backdrop behind dialogs and the asset sheet
  danger: string // delete, errors
  dangerText: string // text on danger
  warning: string // a running-out timer, the reconnect banner
  warningText: string // text on warning
  accent: string // stars, the winner, points
}
