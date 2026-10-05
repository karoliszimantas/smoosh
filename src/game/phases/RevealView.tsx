import type { PhaseProps } from '../types'
import { useGameServices } from '../services'

export default function RevealView({ snapshot }: PhaseProps) {
  const { Picture } = useGameServices()
  const phase = snapshot.phase
  if (phase.phase !== 'reveal') return null

  const nameById = new Map(snapshot.players.map((p) => [p.id, p.name]))
  const pointsByPlayer = new Map(phase.pointsThisPicture.map((p) => [p.playerId, p.points]))

  return (
    <div className="reveal-view">
      <Picture imagePath={phase.imagePath} />

      <ul className="reveal-options">
        {phase.options.map((opt) => (
          <li key={opt.id} className={opt.isTruth ? 'reveal-option truth' : 'reveal-option'}>
            <span className="reveal-option-text">{opt.text}</span>
            {opt.isTruth ? (
              <span className="reveal-option-label">the real prompt</span>
            ) : (
              opt.authorId && <span className="reveal-option-label">by {nameById.get(opt.authorId) ?? '?'}</span>
            )}
            {opt.pickedBy.length > 0 && (
              <span className="reveal-picked-by">picked by {opt.pickedBy.map((id) => nameById.get(id) ?? '?').join(', ')}</span>
            )}
          </li>
        ))}
      </ul>

      <ul className="reveal-points">
        {[...pointsByPlayer.entries()].map(([playerId, points]) => (
          <li key={playerId}>
            {nameById.get(playerId) ?? '?'}: +{points}
          </li>
        ))}
      </ul>
    </div>
  )
}
