import type { PhaseProps } from '../types'
import { useGameServices } from '../services'
import PlayerDot from '../PlayerDot'

// "Mara", "Mara and Teo", "Mara, Teo and Bob"
function nameList(names: string[]): string {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export default function RevealView({ snapshot }: PhaseProps) {
  const { Picture } = useGameServices()
  const phase = snapshot.phase
  if (phase.phase !== 'reveal') return null

  const nameById = new Map(snapshot.players.map((p) => [p.id, p.name]))
  const playerById = new Map(snapshot.players.map((p) => [p.id, p]))
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
              <div className="reveal-picked-by">
                <span className="field-label on-paper">picked by</span>
                <ul className="dot-row" aria-label={`Picked by ${nameList(opt.pickedBy.map((id) => nameById.get(id) ?? '?'))}`}>
                  {opt.pickedBy.map((id) => {
                    const player = playerById.get(id)
                    return (
                      player && (
                        <li key={id}>
                          <PlayerDot player={player} labelled />
                        </li>
                      )
                    )
                  })}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>

      <ul className="reveal-points">
        {[...pointsByPlayer.entries()].map(([playerId, points]) => {
          const player = playerById.get(playerId)
          return (
            <li key={playerId} className="dot-name">
              {player && <PlayerDot player={player} labelled />}
              {nameById.get(playerId) ?? '?'}: +{points}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
