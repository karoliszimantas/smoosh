import { describe, it, expect, afterAll } from 'vitest'
import { THEMES } from './index'
import type { Theme } from './types'

// WCAG 2 contrast for every colour pair the two themes put on screen, read
// off how index.css and the components actually use the vars: text on what
// it sits on (4.5:1), and the edges of controls and focus rings against what
// is next to them (3:1, non-text UI). A pair drawn with alpha is composited
// over what it lies on first. Decorative pairs carry no minimum, but they
// are listed with the reason, so nothing is skipped silently. Run it and
// read the table it prints.

type Rgb = [number, number, number]
type Rgba = [number, number, number, number]

function parse(colour: string): Rgba {
  const hex = colour.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1]
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).concat(1) as Rgba
  }
  const fn = colour.match(/^rgba?\(([^)]+)\)$/)?.[1]
  if (fn) {
    const [r = 0, g = 0, b = 0, a = 1] = fn.split(',').map((v) => Number(v.trim()))
    return [r, g, b, a]
  }
  throw new Error(`not a colour: ${colour}`)
}

const hexOf = ([r, g, b]: Rgb) => '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('').toUpperCase()

// paint `top` (with its alpha, times `opacity`) over an opaque `under`,
// as the browser composites, in sRGB
function over(top: string, under: string, opacity = 1): string {
  const [r, g, b, a] = parse(top)
  const u = parse(under)
  const k = a * opacity
  return hexOf([r * k + u[0] * (1 - k), g * k + u[1] * (1 - k), b * k + u[2] * (1 - k)])
}

// mix-blend-mode: multiply
function multiply(top: string, under: string): string {
  const t = parse(top)
  const u = parse(under)
  return hexOf([(t[0] * u[0]) / 255, (t[1] * u[1]) / 255, (t[2] * u[2]) / 255])
}

// filter: grayscale(1), the CSS filter's matrix on sRGB values
function grayscale(colour: string): string {
  const [r, g, b] = parse(colour)
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return hexOf([y, y, y])
}

function luminance(colour: string): number {
  const [r, g, b, a] = parse(colour)
  if (a !== 1) throw new Error(`composite ${colour} over its background first`)
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// text: 4.5. ui: a control's edge, a state or a focus ring, 3. decor: no
// minimum — the note says why the pair carries nothing a player has to read
type Kind = 'text' | 'ui' | 'decor'
const MIN: Record<Kind, number> = { text: 4.5, ui: 3, decor: 0 }
type Pair = [label: string, colours: (t: Theme) => [fg: string, bg: string], kind: Kind, note?: string]

// the faded avatar of a player who's away: grayscale(1) at .55 over the grey pill
const awayAvatar = (t: Theme, seat: { bg: string }) => over(grayscale(seat.bg), t.awayChip, 0.55)
const awayInitial = (t: Theme, seat: { fg: string; bg: string }) => over(grayscale(seat.fg), awayAvatar(t, seat), 0.55)

const PAIRS: Pair[] = [
  // ---- on the desk (pageBg): body text, the status strip, round notes
  ['text on the desk', (t) => [t.textPrimary, t.pageBg], 'text'],
  ['muted text on the desk', (t) => [t.textMuted, t.pageBg], 'text'],
  ['error text on the desk', (t) => [t.dangerOnDesk, t.pageBg], 'text'],
  ['a pending player’s initial (ghost)', (t) => [t.ghost, t.pageBg], 'text'],
  ['the photo cutter’s error, on its black screen', (t) => [t.warning, '#000000'], 'text'],
  ['the gallery wall’s text', (t) => [t.gallery.wallText, t.gallery.wall], 'text'],
  ['muted text on the gallery wall', (t) => [t.textMuted, t.gallery.wall], 'text'],

  // ---- on paper (surface): cards, chips, fields, the toolbar, sheets
  ['ink on paper', (t) => [t.surfaceText, t.surface], 'text'],
  ['muted ink on paper', (t) => [t.surfaceTextMuted, t.surface], 'text'],
  ['red ink on paper (deltas, errors, links)', (t) => [t.primaryInk, t.surface], 'text'],
  ['green ink on paper (found it)', (t) => [t.successInk, t.surface], 'text'],
  ['the REAL stamp, multiplied into paper', (t) => [multiply(t.paper.stamp, t.surface), t.surface], 'text'],
  ['ink on paper at 85% over a black picture', (t) => [t.surfaceText, over(t.surface, '#000000', 0.85)], 'text'],
  ['ink on a used word chip', (t) => [t.surfaceText, t.successTint], 'text'],
  ['the white check on a used word chip', (t) => ['#FFFFFF', t.successInk], 'text'],
  ['disabled / your own lie (sunken)', (t) => [t.surfaceSunkenText, t.surfaceSunken], 'text'],
  ['ink on picked yellow (picked, on, your row)', (t) => [t.line, t.picked], 'text'],
  ['PICKED tab: yellow on ink', (t) => [t.picked, t.line], 'text'],
  ['the Away tag: paper on ink', (t) => [t.surface, t.line], 'text'],
  ['a name on the away pill', (t) => [t.surfaceText, t.awayChip], 'text'],
  ['the primary button', (t) => [t.primaryText, t.primaryBg], 'text'],
  ['the danger button', (t) => [t.dangerText, t.danger], 'text'],
  ['the warning banner', (t) => [t.warningText, t.warning], 'text'],
  ['the room code’s Dymo label', (t) => [t.paper.dymo.text, t.paper.dymo.bg], 'text'],
  ['the timer’s digits', (t) => [t.surfaceText, t.timer.calm], 'text'],
  ['the timer’s digits, last 10 seconds', (t) => [t.line, t.timer.hot], 'text'],
  ['a seat badge’s shape', (t) => [t.line, t.markBadge], 'text'],
  ['the museum label', (t) => [t.gallery.placardText, t.gallery.placardBg], 'text'],
  ['the museum label, muted', (t) => [t.gallery.placardMuted, t.gallery.placardBg], 'text'],
  ['the burst’s +N figure, on the star', (t) => [t.burstFigure, t.picked], 'text'],
  ['the burst figure’s ink stroke, on the star', (t) => [t.line, t.picked], 'text'],
  ...[0, 1, 2].map(
    (i): Pair => [`ink on prompt chip ${i}`, (t) => [t.line, t.promptChips[i] ?? t.surface], 'text'],
  ),
  ...[0, 1, 2, 3, 4, 5].map(
    (i): Pair => [`ink on wordmark scrap ${i}`, (t) => [t.line, t.wordmark[i] ?? t.surface], 'text'],
  ),
  ...(['best', 'second', 'divisive', 'everybodysSecond', 'honourable'] as const).map(
    (award): Pair => [`the ${award} rosette`, (t) => [t.gallery.ribbons[award].ink, t.gallery.ribbons[award].face], 'text'],
  ),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i): Pair => [`seat ${i}’s initial`, (t) => [seat(t, i).fg, seat(t, i).bg], 'text']),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map(
    (i): Pair => [
      `seat ${i}’s initial, away (faded)`,
      (t) => [awayInitial(t, seat(t, i)), awayAvatar(t, seat(t, i))],
      'decor',
      'deliberately faded: the away player’s name and the ink Away tag beside it say it',
    ],
  ),

  // ---- non-text: what tells a control, a state or the focus apart
  ['focus ring on the desk', (t) => [t.focus, t.pageBg], 'ui'],
  ['focus ring inside paper', (t) => [t.focusOnPaper, t.surface], 'ui'],
  ['focus ring on the gallery wall (a picked vote)', (t) => [t.focus, t.gallery.wall], 'ui'],
  ['the canvas selection on the picture’s paper', (t) => [t.selectionColor, t.canvasBg], 'ui'],
  ['ink borders on paper (fields, buttons)', (t) => [t.line, t.surface], 'ui'],
  // a control on the desk is told apart by its paper or by its 2–2.5px ink
  // border, whichever stands out: the paper on Night, the border on Day
  ['a paper control’s edge on the desk', (t) => [strongest(t.pageBg, t.surface, t.line), t.pageBg], 'ui'],
  ['your chip’s dashed ring on the desk', (t) => [t.textPrimary, t.pageBg], 'ui'],
  ['the primary button’s ink border on its fill', (t) => [t.line, t.primaryBg], 'ui'],
  ['the fuse’s ink rim on its track', (t) => [t.line, t.timer.track], 'ui'],
  ['the chain strip’s dashed line on the picture', (t) => [t.chromeBorder, t.canvasBg], 'ui'],

  // ---- decorative: listed so nothing is skipped silently
  ['paper against the desk', (t) => [t.surface, t.pageBg], 'decor', 'Day 1.27: paper controls carry a 2–2.5px ink border (above)'],
  ['tape (85%) on paper', (t) => [over(t.paper.tape ?? t.surface, t.surface, 0.85), t.surface], 'decor', 'holds cards down; carries nothing'],
  ['the desk’s dot grid', (t) => [over(t.paper.dot ?? t.pageBg, t.pageBg), t.pageBg], 'decor', 'texture'],
  ['the sticker edge on the picture’s paper', (t) => [t.stickerEdge?.color ?? t.canvasBg, t.canvasBg], 'decor', 'the cut-out’s rim; the lift shadow under it draws the edge'],
  ['the fuse’s burn on its track', (t) => [t.picked, t.timer.track], 'decor', 'the digits above it say the time; the fill has an ink rim'],
  ['a picked guess against the desk', (t) => [t.picked, t.pageBg], 'decor', 'the ink PICKED tab carries the state (above)'],
  ['the first wordmark scrap on the desk (Home)', (t) => [t.wordmark[0], t.pageBg], 'decor', 'a logotype; its ink letters and hard shadow carry it'],
  ['crop / erase: the dimmed surround (desk at 78%) on the picture', (t) => [over(t.pageBg, t.canvasBg, 0.78), t.canvasBg], 'decor', 'the red frame on the picture’s paper (above) marks the edge'],
  ['a seat’s avatar on its paper pill', (t) => [seat(t, 1).bg, t.surface], 'decor', 'the name and the initial identify the player'],
]

// seat i's colours; a room seats 8
function seat(t: Theme, i: number): { bg: string; fg: string } {
  const s = t.players[i]
  if (!s) throw new Error(`${t.id} has no seat ${i}`)
  return s
}

// the candidate that stands out most against `bg`
function strongest(bg: string, ...candidates: string[]): string {
  return candidates.reduce((best, c) => (contrast(c, bg) > contrast(best, bg) ? c : best))
}

// pairs that fail on purpose in one theme: an owner's decision or a
// documented exception. Each is held to failing still, so a stale entry
// shows up and gets removed
const EXCEPTIONS: Record<string, string> = {
  // decision 3 (2026-10-16): Night keeps the artboard's orange figure; the
  // ink stroke round it (the next pair) is the text edge, at 13:1
  'night: the burst’s +N figure, on the star': 'orange as drawn; read by its ink stroke',
}

type Row = { theme: string; kind: Kind; min: number; ratio: number; pair: string; fg: string; bg: string; note: string }
const rows: Row[] = THEMES.flatMap((t) =>
  PAIRS.map(([label, colours, kind, note]): Row => {
    const [fg, bg] = colours(t)
    const exception = EXCEPTIONS[`${t.id}: ${label}`]
    const k: Kind = exception ? 'decor' : kind
    return { theme: t.id, kind: k, min: MIN[k], ratio: contrast(fg, bg), pair: label, fg, bg, note: exception ?? note ?? '' }
  }),
)

describe('contrast', () => {
  it.each(rows.filter((r) => r.kind !== 'decor').map((r) => [`${r.theme}: ${r.pair}`, r] as const))(
    '%s',
    (_, r) => {
      expect(r.ratio, `${r.fg} on ${r.bg}`).toBeGreaterThanOrEqual(r.min)
    },
  )

  it.each(Object.keys(EXCEPTIONS))('%s still needs its exception', (key) => {
    const r = rows.find((row) => `${row.theme}: ${row.pair}` === key)
    expect(r, 'an exception names a pair that exists').toBeDefined()
    const [, , kind] = PAIRS.find(([label]) => label === r?.pair) ?? []
    expect(r?.ratio).toBeLessThan(MIN[kind ?? 'text'])
  })

  it('composites alpha and blends before measuring', () => {
    expect(over('rgba(0,0,0,.5)', '#FFFFFF')).toBe('#808080')
    expect(multiply('#D7141A', '#FFFFFF')).toBe('#D7141A')
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
  })
})

// the whole table, for the record: every pair, theme by theme
afterAll(() => {
  const line = (r: Row) =>
    [
      r.theme.padEnd(5),
      r.kind.padEnd(5),
      (r.min ? r.min.toFixed(1) : '–').padStart(3),
      r.ratio.toFixed(2).padStart(6),
      r.kind === 'decor' ? '    ' : r.ratio >= r.min ? 'ok  ' : 'FAIL',
      `${r.fg} on ${r.bg}`.padEnd(19),
      r.pair + (r.note ? ` — ${r.note}` : ''),
    ].join('  ')
  console.log(['theme  kind   min  ratio        colours              pair', ...rows.map(line)].join('\n'))
})
