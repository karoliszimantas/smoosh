import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent } from 'react'
import { optionText } from '@smoosh/protocol'
import type { PhaseProps } from '../types'
import { useGameServices } from '../services'
import { actionErrorText } from '../roomMessages'
import RoomProgress from '../RoomProgress'
import Tape from '../../components/Tape'
import { scheduleAutoLock } from '../autoLock'

const NEXT_KEYS = new Set(['ArrowDown', 'ArrowRight'])
const PREV_KEYS = new Set(['ArrowUp', 'ArrowLeft'])

// Which one is real? (Guess.dc.html): the picture, then every prompt on a
// torn scrap. A tap picks one (yellow, PICKED on its edge) and Lock in
// sends it — one guess per picture, as before, only now with a moment to
// change your mind. A pick still not locked in when time runs out is sent
// anyway (autoLock.ts). Your own lie lies flat on the desk, greyed,
// unpickable. Every option is set in one form (optionText), the real one
// and the fakes alike, so only the words can give one away.
export default function GuessView({ snapshot, emit }: PhaseProps) {
  const { Picture } = useGameServices()
  const phase = snapshot.phase

  // picked on this screen, not yet sent
  const [choice, setChoice] = useState<string | null>(null)
  // sent from this screen; after a reload, the server's record says it
  const [sent, setSent] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // in flight: a tap on Lock in and the time-out landing together send once
  const sendingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const optionRefs = useRef(new Map<string, HTMLButtonElement>())

  const guessing = phase.phase === 'guess'
  const isAuthor = guessing && phase.authorId === snapshot.you.playerId
  const lockedId = sent ?? snapshot.you.ownGuessId
  const locked = lockedId !== null || snapshot.you.hasActedThisPhase

  const lockIn = async () => {
    if (phase.phase !== 'guess' || locked || sendingRef.current || choice === null) return
    sendingRef.current = true
    setBusy(true)
    const res = await emit('guess:submit', { pictureIndex: phase.pictureIndex, optionId: choice })
    sendingRef.current = false
    setBusy(false)
    if (!res.ok) {
      setError(actionErrorText(res.code))
      return
    }
    setError(null)
    setSent(choice)
  }

  // time's up with a pick not locked in: lock it in. Re-armed when the
  // deadline moves (the clock paused while nobody was here); disarmed once
  // locked, and on leaving this picture
  const onTimeUp = useEffectEvent(() => void lockIn())
  const deadline = guessing ? phase.deadline : null
  const armed = guessing && !isAuthor && !locked && choice !== null
  useEffect(() => scheduleAutoLock(deadline, armed, onTimeUp), [deadline, armed])

  if (phase.phase !== 'guess') return null

  const ownLie = snapshot.you.ownOptionId
  const picked = locked ? lockedId : choice
  const pickable = phase.options.filter((o) => o.id !== ownLie).map((o) => o.id)

  const pick = (optionId: string) => {
    if (locked || optionId === ownLie) return
    setChoice(optionId)
    setError(null)
  }

  // a radio group: the arrow keys move the pick (and focus) between the
  // options you can pick, round from the last to the first
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (locked || pickable.length === 0) return
    const step = NEXT_KEYS.has(e.key) ? 1 : PREV_KEYS.has(e.key) ? -1 : 0
    if (step === 0) return
    e.preventDefault()
    // from the option that has focus (Tab lands on one before anything is
    // picked), else from the pick
    const focused = [...optionRefs.current].find(([, el]) => el === document.activeElement)?.[0]
    const from = focused ?? picked
    const at = from === null ? -1 : pickable.indexOf(from)
    const next = pickable[at === -1 ? (step === 1 ? 0 : pickable.length - 1) : (at + step + pickable.length) % pickable.length]
    if (next === undefined) return
    pick(next)
    optionRefs.current.get(next)?.focus()
  }

  // the one option the Tab key lands on: the pick, or the first pickable
  const tabStop = picked ?? pickable[0] ?? null

  return (
    <div className={isAuthor ? 'guess-view author' : 'guess-view'}>
      <div className="guess-scroll">
        <div className="picture-frame">
          <Picture imagePath={phase.imagePath} />
          <Tape />
        </div>

        {isAuthor ? (
          <>
            <p className="round-note">This one’s yours. Keep a straight face.</p>
            <RoomProgress snapshot={snapshot} verb="guessed" exclude={[phase.authorId]} dots />
          </>
        ) : (
          <section className="guess-choices" aria-labelledby="guess-question">
            <h1 id="guess-question" className="round-heading">
              Which one is real?
            </h1>
            <div className="guess-options" role="radiogroup" aria-labelledby="guess-question" onKeyDown={onKeyDown}>
              {phase.options.map((opt, i) => {
                const isOwnLie = opt.id === ownLie
                const isPicked = picked === opt.id
                const edge = i % 2 === 0 ? 'torn' : 'torn torn-b'
                const state = isOwnLie ? ' own-lie torn-flat' : isPicked ? ' picked' : ''
                return (
                  <div key={opt.id} className="guess-option-slot">
                    <button
                      ref={(el) => {
                        if (el) optionRefs.current.set(opt.id, el)
                        else optionRefs.current.delete(opt.id)
                      }}
                      type="button"
                      role="radio"
                      aria-checked={isPicked}
                      aria-disabled={isOwnLie || locked ? true : undefined}
                      tabIndex={opt.id === tabStop ? 0 : -1}
                      className={`guess-option ${edge}${state}`}
                      onClick={() => pick(opt.id)}
                    >
                      <span className="guess-option-text">{optionText(opt.text)}</span>
                      {isOwnLie && (
                        <>
                          {/* a comma, so it's read as "…, your lie" */}
                          <span className="visually-hidden">,</span> <span className="your-lie-label">Your lie</span>
                        </>
                      )}
                    </button>
                    {isPicked && (
                      <span className="picked-label" aria-hidden="true">
                        {locked ? 'Locked' : 'Picked'}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </div>

      {!isAuthor && (
        <div className="guess-foot">
          {locked ? (
            // every option is shut now: say why, or it reads as frozen. No
            // dots here, to keep the options in view: the strip has them
            <>
              <p className="round-note">Locked in.</p>
              <RoomProgress snapshot={snapshot} verb="guessed" exclude={[phase.authorId]} />
            </>
          ) : (
            <>
              {error && <p className="form-error">{error}</p>}
              <button className="btn btn-primary btn-block" disabled={choice === null || busy} onClick={() => void lockIn()}>
                Lock in
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
