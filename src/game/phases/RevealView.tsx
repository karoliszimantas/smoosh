import type { PhaseProps } from '../types'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'

export default function RevealView({ snapshot }: PhaseProps) {
  const phase = snapshot.phase
  if (phase.phase !== 'reveal') return null

  const nameById = new Map(snapshot.players.map((p) => [p.id, p.name]))
  const pointsByPlayer = new Map(phase.pointsThisPicture.map((p) => [p.playerId, p.points]))

  return (
    <div className="reveal-view">
      <img className="picture-display" src={`${SERVER_URL}${phase.imagePath}`} alt="" />

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
