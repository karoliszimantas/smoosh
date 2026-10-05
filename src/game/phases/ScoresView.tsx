import type { PhaseProps } from '../types'

export default function ScoresView({ snapshot, emit }: PhaseProps) {
  const phase = snapshot.phase
  if (phase.phase !== 'scores') return null

  const nameById = new Map(snapshot.players.map((p) => [p.id, p.name]))
  const presenceById = new Map(snapshot.players.map((p) => [p.id, p.presence]))
  const ranked = [...phase.scoreboard].sort((a, b) => b.total - a.total)
  const winner = phase.isFinalRound ? ranked[0] : undefined

  return (
    <div className="scores-view">
      <h1>{phase.isFinalRound ? 'Final scores' : `Round ${phase.round} of ${phase.totalRounds}`}</h1>

      {winner && <p className="scores-winner">{nameById.get(winner.playerId) ?? '?'} wins!</p>}

      <ol className="scoreboard">
        {ranked.map((entry) => (
          <li key={entry.playerId} className={presenceById.get(entry.playerId) === 'away' ? 'away' : ''}>
            {nameById.get(entry.playerId) ?? '?'} — {entry.total}
            {presenceById.get(entry.playerId) === 'away' && <span className="away-marker">away</span>}
            {presenceById.get(entry.playerId) === 'left' && <span className="away-marker">left</span>}
          </li>
        ))}
      </ol>

      {phase.isFinalRound && snapshot.you.isHost && (
        <button onClick={() => void emit('room:playAgain', {})}>Play again</button>
      )}
      {phase.isFinalRound && !snapshot.you.isHost && <p className="phase-status">Waiting for the host to start a new game…</p>}
    </div>
  )
}
