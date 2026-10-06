import { useState } from 'react'
import type { PhaseProps } from '../types'
import { useGameServices } from '../services'
import DeadlineTimer from '../DeadlineTimer'
import { actionErrorText } from '../roomMessages'
import RoomProgress from '../RoomProgress'

export default function GuessView({ snapshot, emit }: PhaseProps) {
  const { Picture } = useGameServices()
  const phase = snapshot.phase

  // what they picked — this screen's tap, or (after a reload) the server's
  // record of it
  const [tapped, setPicked] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (phase.phase !== 'guess') return null

  const isAuthor = phase.authorId === snapshot.you.playerId
  const picked = tapped ?? snapshot.you.ownGuessId
  const alreadyGuessed = snapshot.you.hasActedThisPhase || picked !== null

  const handlePick = async (optionId: string) => {
    if (alreadyGuessed || optionId === snapshot.you.ownOptionId) return
    setPicked(optionId)
    const res = await emit('guess:submit', { pictureIndex: phase.pictureIndex, optionId })
    if (!res.ok) {
      setError(actionErrorText(res.code))
      setPicked(null)
    }
  }

  return (
    <div className="guess-view">
      <DeadlineTimer deadline={phase.deadline} />
      <Picture imagePath={phase.imagePath} />

      {isAuthor ? (
        <>
          <p className="phase-status">This one’s yours — waiting for everyone else to guess.</p>
          <RoomProgress snapshot={snapshot} verb="guessed" exclude={[phase.authorId]} />
        </>
      ) : (
        <div className="guess-options">
          {phase.options.map((opt) => {
            const isOwnLie = opt.id === snapshot.you.ownOptionId
            const isPicked = picked === opt.id
            return (
              <button
                key={opt.id}
                className={`guess-option${isPicked ? ' picked' : ''}${isOwnLie ? ' own-lie' : ''}`}
                disabled={isOwnLie || (alreadyGuessed && !isPicked)}
                onClick={() => void handlePick(opt.id)}
              >
                {opt.text}
                {isOwnLie && <span className="option-note">your lie</span>}
              </button>
            )
          })}
          {error && <p className="form-error">{error}</p>}
          {/* every option is disabled now: say why, or it reads as frozen */}
          {alreadyGuessed && !error && (
            <>
              <p className="phase-status">Guess locked in — waiting for the others…</p>
              <RoomProgress snapshot={snapshot} verb="guessed" exclude={[phase.authorId]} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
