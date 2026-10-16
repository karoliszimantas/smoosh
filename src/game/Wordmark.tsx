import type { CSSProperties } from 'react'
import Tape from '../components/Tape'

// The ransom-note wordmark (Main.dc.html, Style.dc.html): six letters, each
// cut from its own coloured scrap, alternately set in Archivo Black and
// Courier Prime, tilted this way and that, one strip of tape on the first.
// Plain markup in the self-hosted fonts, not outlined glyphs: it renders
// as drawn and stays two kilobytes of DOM. One image to a screen reader.
//
// `lg` is Home's (64–78px scraps), `sm` the header and menu size (35–43px).

// the scraps' cut edges, as drawn: three shapes, used twice each
const CUT_A = 'polygon(3% 6%,30% 0%,62% 5%,97% 1%,100% 40%,95% 72%,99% 96%,66% 100%,35% 94%,4% 99%,0% 63%,5% 31%)'
const CUT_B = 'polygon(0% 3%,41% 7%,72% 0%,100% 6%,96% 35%,100% 68%,97% 100%,58% 95%,24% 100%,2% 94%,5% 58%,0% 27%)'
const CUT_C = 'polygon(6% 0%,38% 4%,70% 1%,95% 7%,100% 33%,96% 62%,100% 92%,71% 98%,40% 94%,8% 100%,0% 70%,4% 36%)'

type Tile = {
  letter: string
  type: 'display' | 'label'
  tilt: number
  cut: string
  lg: [height: number, fontSize: number]
  sm: [height: number, fontSize: number]
}

const TILES: readonly Tile[] = [
  { letter: 's', type: 'display', tilt: -4, cut: CUT_A, lg: [70, 54], sm: [38, 28] },
  { letter: 'm', type: 'label', tilt: 3, cut: CUT_B, lg: [76, 62], sm: [42, 33] },
  { letter: 'o', type: 'display', tilt: -2, cut: CUT_C, lg: [64, 50], sm: [35, 26] },
  { letter: 'o', type: 'label', tilt: 4, cut: CUT_A, lg: [72, 62], sm: [40, 33] },
  { letter: 's', type: 'display', tilt: -3, cut: CUT_B, lg: [68, 52], sm: [37, 27] },
  { letter: 'h', type: 'label', tilt: 2, cut: CUT_C, lg: [78, 64], sm: [43, 34] },
]

export default function Wordmark({ size = 'lg', className }: { size?: 'lg' | 'sm'; className?: string }) {
  const lg = size === 'lg'
  return (
    <span className={`wordmark wordmark-${size}${className ? ` ${className}` : ''}`} role="img" aria-label="smoosh">
      <span className="wordmark-tiles">
        {TILES.map((t, i) => {
          const [height, fontSize] = lg ? t.lg : t.sm
          const style = {
            height,
            fontSize,
            background: `var(--wordmark-${i})`,
            transform: `rotate(${t.tilt}deg)`,
            '--cut': t.cut,
          } as CSSProperties
          return (
            <span key={i} className={`wordmark-tile ${t.type}`} style={style} aria-hidden="true">
              {t.letter}
            </span>
          )
        })}
      </span>
      {lg ? <Tape x={-18} y={-6} /> : <Tape x={-14} y={-6} className="tape-sm" />}
    </span>
  )
}
