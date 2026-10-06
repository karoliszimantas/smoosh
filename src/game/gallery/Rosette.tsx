import type { Award } from '@smoosh/protocol'

// A fairground prize rosette, struck over the corner of a frame: pleated
// ribbon, a printed centre, two notched tails. Inline SVG, coloured by the
// theme (--ribbon-<award>-face/edge/ink in index.css) — it should look like
// something pinned on, not a badge.

const LABELS: Record<Award, [string, string]> = {
  best: ['BEST', 'IN SHOW'],
  second: ['SECOND', 'PRIZE'],
  divisive: ['MOST', 'DIVISIVE'],
  everybodysSecond: ['EVERYBODY’S', 'SECOND'],
  honourable: ['HONOURABLE', 'MENTION'],
}

// a ring of pleats: points alternating between two radii
function pleats(count: number, outer: number, inner: number, cx = 50, cy = 46): string {
  const pts: string[] = []
  for (let i = 0; i < count * 2; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = (Math.PI * i) / count - Math.PI / 2
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`)
  }
  return pts.join(' ')
}

const OUTER = pleats(36, 47, 40)
const INNER = pleats(28, 35, 31)
// the fold between pleats, printed on
const FOLDS = Array.from({ length: 36 }, (_, i) => {
  const a = (Math.PI * 2 * i) / 36 - Math.PI / 2
  return { x1: 50 + 36 * Math.cos(a), y1: 46 + 36 * Math.sin(a), x2: 50 + 46 * Math.cos(a), y2: 46 + 46 * Math.sin(a) }
})
const TAIL = 'M-9,0 L9,0 L9,76 L0,67 L-9,76 Z'

// a line of type set to fit the centre whatever the theme's face: long
// words are squeezed, not shrunk
function Line({ text, y }: { text: string; y: number }) {
  return (
    <text x="50" y={y} textAnchor="middle" textLength={Math.min(36, text.length * 5.6)} lengthAdjust="spacingAndGlyphs">
      {text}
    </text>
  )
}

export default function Rosette({ award, size = 'normal' }: { award: Award; size?: 'large' | 'normal' | 'small' }) {
  const [top, bottom] = LABELS[award]
  return (
    <svg className={`rosette rosette-${award} rosette-${size}`} viewBox="0 0 100 132" aria-hidden="true">
      <g className="rosette-tails">
        <g transform="translate(43,54) rotate(16)">
          <path d={TAIL} />
          <rect className="rosette-stripe" x="-3" y="0" width="6" height="70" />
        </g>
        <g transform="translate(57,54) rotate(-16)">
          <path d={TAIL} />
          <rect className="rosette-stripe" x="-3" y="0" width="6" height="70" />
        </g>
      </g>
      <polygon className="rosette-outer" points={OUTER} />
      <g className="rosette-folds">
        {FOLDS.map((f, i) => (
          <line key={i} x1={f.x1} y1={f.y1} x2={f.x2} y2={f.y2} />
        ))}
      </g>
      <polygon className="rosette-inner" points={INNER} />
      <circle className="rosette-centre" cx="50" cy="46" r="25" />
      <circle className="rosette-rule" cx="50" cy="46" r="21.5" />
      <g className="rosette-text">
        <Line text={top} y={44} />
        <Line text={bottom} y={54} />
      </g>
    </svg>
  )
}
