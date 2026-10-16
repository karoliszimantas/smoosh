import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDialog } from './useDialog'
import Tape from '../components/Tape'
import { HOW_TO_PLAY_STEPS } from './howToPlayText'

// a swipe this far across the card turns it
const SWIPE_PX = 40

// Each card: a little scrap-paper picture (decoration, hidden from screen
// readers — the words carry it), a title and a line or two.
const ART = [<BuildArt />, <FakeArt />, <SpotArt />]

// The three how-to-play cards, on a paper card over the desk: Next (or a
// swipe, or the arrow keys) through them, Back, and Skip always there.
// Opened by the player, from Home and the menu (a first Lobby has the
// quiet HowToPlayNote instead).
export default function HowToPlay({ onClose, returnFocus }: { onClose: () => void; returnFocus?: () => HTMLElement | null }) {
  const [step, setStep] = useState(0)
  const ref = useDialog<HTMLDivElement>(onClose, returnFocus)
  const swipeFrom = useRef<number | null>(null)
  const last = HOW_TO_PLAY_STEPS.length - 1
  const { title, text } = HOW_TO_PLAY_STEPS[step] ?? HOW_TO_PLAY_STEPS[0]
  const art = ART[step]
  const next = () => (step < last ? setStep(step + 1) : onClose())
  const back = () => setStep(Math.max(0, step - 1))

  return createPortal(
    <div className="htp-scrim" onClick={onClose}>
      <div
        ref={ref}
        className="paper-card htp"
        role="dialog"
        aria-modal="true"
        aria-labelledby="htp-title"
        aria-describedby="htp-page"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' && step < last) setStep(step + 1)
          else if (e.key === 'ArrowLeft') back()
        }}
      >
        <h2 id="htp-title" className="field-label on-paper htp-head">
          <span>How to play</span>
          <span>
            {step + 1} of {HOW_TO_PLAY_STEPS.length}
          </span>
        </h2>
        <div
          id="htp-page"
          className="htp-page"
          aria-live="polite"
          onPointerDown={(e) => (swipeFrom.current = e.clientX)}
          onPointerCancel={() => (swipeFrom.current = null)}
          onPointerUp={(e) => {
            const from = swipeFrom.current
            swipeFrom.current = null
            if (from === null) return
            const dx = e.clientX - from
            if (dx <= -SWIPE_PX && step < last) setStep(step + 1)
            else if (dx >= SWIPE_PX) back()
          }}
        >
          {/* keyed, so each card arrives afresh (the stepped deal) */}
          <div key={step} className="htp-card">
            <div className="htp-art" aria-hidden="true">
              {art}
            </div>
            <h3 className="htp-title">{title}</h3>
            <p className="htp-text">{text}</p>
          </div>
        </div>
        <ol className="htp-dots" aria-hidden="true">
          {HOW_TO_PLAY_STEPS.map((c, i) => (
            <li key={c.title} className={i === step ? 'on' : undefined} />
          ))}
        </ol>
        <div className="htp-actions">
          <button className="btn-link htp-skip" onClick={onClose}>
            Skip
          </button>
          {step > 0 && (
            <button className="btn btn-secondary btn-inset btn-sm" onClick={back}>
              Back
            </button>
          )}
          <button className="btn btn-primary btn-inset htp-next" data-autofocus onClick={next}>
            {step < last ? 'Next' : 'Let’s play'}
          </button>
        </div>
        <Tape />
      </div>
    </div>,
    document.body,
  )
}

// two photo scraps, taped together under a secret prompt
function BuildArt() {
  return (
    <div className="htp-build">
      <span className="htp-prompt">A cat on a bus</span>
      <span className="htp-scrap htp-scrap-a">
        <span className="htp-sun" />
      </span>
      <span className="htp-scrap htp-scrap-b" />
      <span className="tape htp-tape" />
    </div>
  )
}

// the picture, and a fake caption being typed under it
function FakeArt() {
  return (
    <div className="htp-fake">
      <span className="htp-thumb">
        <span className="htp-scrap htp-scrap-a" />
        <span className="htp-scrap htp-scrap-b" />
      </span>
      <span className="htp-slip htp-slip-typing">
        A dog at the denti<span className="htp-caret" />
      </span>
    </div>
  )
}

// three captions, the real one stamped
function SpotArt() {
  return (
    <div className="htp-spot">
      <span className="htp-slip">Grandma’s new car</span>
      <span className="htp-slip htp-slip-real">
        A cat on a bus
        <span className="real-stamp htp-stamp">Real</span>
      </span>
      <span className="htp-slip">A dog at the dentist</span>
    </div>
  )
}
