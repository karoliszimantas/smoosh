import { useState } from 'react'
import type { PhaseProps } from '../types'
import { useGameServices } from '../services'
import DeadlineTimer from '../DeadlineTimer'
import { actionErrorText } from '../roomMessages'

export default function LieView({ snapshot, emit }: PhaseProps) {
  const { Picture } = useGameServices()
  const phase = snapshot.phase

  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(snapshot.you.hasActedThisPhase)

  if (phase.phase !== 'lie') return null

  const isAuthor = phase.authorId === snapshot.you.playerId

  const handleSubmit = async () => {
    const trimmed = text.trim()
    if (!trimmed) return
    const res = await emit('lie:submit', { pictureIndex: phase.pictureIndex, text: trimmed })
    if (!res.ok) {
      setError(actionErrorText(res.code))
      return
    }
    setError(null)
    setSubmitted(true)
  }

  return (
    <div className="lie-view">
      <DeadlineTimer deadline={phase.deadline} />
      <Picture imagePath={phase.imagePath} />

      {isAuthor ? (
        <p className="phase-status">Everyone else is writing fake prompts for your picture…</p>
      ) : submitted ? (
        <p className="phase-status">Lie submitted — waiting for others…</p>
      ) : (
        <div className="lie-form">
          <input
            placeholder="Write a convincing fake prompt"
            maxLength={80}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {error && <p className="form-error">{error}</p>}
          <button onClick={() => void handleSubmit()} disabled={!text.trim()}>
            Submit
          </button>
        </div>
      )}
    </div>
  )
}
