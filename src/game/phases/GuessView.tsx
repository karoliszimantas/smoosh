import { useState } from 'react'
import type { PhaseProps } from '../types'
import { useGameServices } from '../services'
import DeadlineTimer from '../DeadlineTimer'
import { actionErrorText } from '../roomMessages'

export default function GuessView({ snapshot, emit }: PhaseProps) {
  const { Picture } = useGameServices()
  const phase = snapshot.phase

  const [picked, setPicked] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (phase.phase !== 'guess') return null

  const isAuthor = phase.authorId === snapshot.you.playerId
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
        <p className="phase-status">Everyone is guessing which prompt made this…</p>
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
              </button>
            )
          })}
          {error && <p className="form-error">{error}</p>}
        </div>
      )}
    </div>
  )
}
