import { useState } from 'react'
import type { Player } from '@smoosh/protocol'
import type { PhaseProps } from '../types'
import { actionErrorText } from '../roomMessages'
import PlayerDot from '../PlayerDot'
import { PlayerAvatar } from '../PlayerChip'
import Tape from '../../components/Tape'
import { ampersandList, finalPlaces, type Place } from '../finalStandings'
import { rankLabel, rankName } from '../ranking'
import { formatPoints } from '../revealSummary'

// the podium's three steps, by place: the winner's in the middle and
// tallest, second to its left, third to its right (Final.dc.html)
const STEPS = [
  { slot: 'first', edge: 'torn-top-b' },
  { slot: 'second', edge: 'torn-top-a' },
  { slot: 'third', edge: 'torn-top-c' },
] as const

// a red pencil ring round the winner's number, drawn in one loop
function PencilRing() {
  return (
    <svg className="podium-ring" width={62} height={58} viewBox="0 0 62 58" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M45 9 C 31 1, 10 7, 8 27 C 6 46, 31 54, 48 44 C 60 36, 57 15, 37 8 L 33 7"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// who stands on a step: one pill with their avatar and name, or, on a tie,
// one pill holding every avatar (their names are on the step)
function StepChip({ players, youId }: { players: Player[]; youId: string }) {
  const you = players.some((p) => p.id === youId)
  const [only] = players
  if (players.length === 1 && only) {
    return (
      <span className={`player-chip podium-chip${you ? ' you' : ''}`}>
        <PlayerAvatar player={only} />
        <span className="player-name">{only.name}</span>
      </span>
    )
  }
  return (
    <span className={`player-chip podium-chip joint${you ? ' you' : ''}`} aria-hidden="true">
      {players.map((p) => (
        <PlayerAvatar key={p.id} player={p} />
      ))}
    </span>
  )
}

// Game over (Final.dc.html): who won on a torn banner, the podium, anyone
// further down, then Play again, Change settings and Leave.
export default function FinalView({ snapshot, emit, onLeave }: PhaseProps & { onLeave: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const phase = snapshot.phase
  if (phase.phase !== 'scores') return null

  const youId = snapshot.you.playerId
  const playerById = new Map(snapshot.players.map((p) => [p.id, p]))
  const playersOf = (place: Place) =>
    place.entries.map((e) => playerById.get(e.playerId)).filter((p): p is Player => p !== undefined)
  // first, second and third stand on the podium — fewer steps when ties
  // leave a place empty (=1, =1, 3) or there are fewer players
  const places = finalPlaces(phase.scoreboard)
  const podium = places.filter((p) => p.rank <= STEPS.length)
  const rest = places
    .filter((p) => p.rank > STEPS.length)
    .flatMap((place) => place.entries.map((entry) => ({ entry, rank: place.rank, tied: place.tied })))
  const winners = podium[0] ? playersOf(podium[0]).map((p) => p.name) : []
  const host = snapshot.players.find((p) => p.isHost && p.presence !== 'left')

  // Play again deals the same table straight back in with the same
  // settings: back to the lobby (the only way a game ends) and start at
  // once. Change settings stops in the lobby, where the host sets the game
  const restart = async (start: boolean) => {
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await emit('room:playAgain', {})
    if (!res.ok) {
      setBusy(false)
      setError(actionErrorText(res.code))
      return
    }
    // the lobby has taken over this screen by now; if the start is refused
    // (too few here), the host is simply in the lobby with Start to hand
    if (start) await emit('room:start', {})
  }

  return (
    <div className="final-view">
      <header className="final-head">
        <p className="field-label">
          Game over · {phase.totalRounds} {phase.totalRounds === 1 ? 'round' : 'rounds'}
        </p>
        <div className="final-banner-wrap">
          <h1 className="torn torn-c final-banner">
            {ampersandList(winners)} {winners.length > 1 ? 'win' : 'wins'}
          </h1>
          <Tape y={-8} />
        </div>
      </header>

      <ol className="podium" aria-label="Podium">
        {podium.map((place, i) => {
          const step = STEPS[place.rank - 1] ?? STEPS[i] ?? STEPS[0]
          const players = playersOf(place)
          const joint = players.length > 1
          return (
            <li key={place.rank} className={`podium-place ${step.slot}`}>
              <StepChip players={players} youId={youId} />
              <div className={`torn ${step.edge} podium-step`}>
                {place.rank === 1 && <PencilRing />}
                <span className="podium-rank">
                  <span aria-hidden="true">{place.rank}</span>
                  <span className="visually-hidden">{rankName(place)} place:</span>
                </span>
                {joint && (
                  <span className="podium-joint">
                    {ampersandList(players.map((p) => p.name))}
                    <br aria-hidden="true" />
                    <span aria-hidden="true">joint</span>
                  </span>
                )}
                <span className="podium-total">
                  {formatPoints(place.total)}
                  <span className="visually-hidden"> points</span>
                </span>
              </div>
            </li>
          )
        })}
      </ol>

      {rest.length > 0 && (
        <ol className="paper-card final-rest" aria-label="Everyone else">
          {rest.map((r) => {
            const player = playerById.get(r.entry.playerId)
            return (
              <li key={r.entry.playerId}>
                <span className="final-rest-rank">
                  <span aria-hidden="true">{rankLabel(r)}</span>
                  <span className="visually-hidden">{rankName(r)}:</span>
                </span>
                {player && <PlayerDot player={player} away={player.presence !== 'present'} labelled />}
                <span className="final-rest-name">{player?.name ?? '?'}</span>
                <span className="final-rest-total">{formatPoints(r.entry.total)}</span>
              </li>
            )
          })}
        </ol>
      )}

      <div className="final-actions">
        {error && <p className="form-error">{error}</p>}
        {snapshot.you.isHost ? (
          <>
            <button className="btn btn-primary btn-block" disabled={busy} onClick={() => void restart(true)}>
              Play again
            </button>
            <button className="btn btn-secondary btn-block" disabled={busy} onClick={() => void restart(false)}>
              Change settings
            </button>
          </>
        ) : (
          <p className="round-note final-waiting">
            {host ? `Waiting for ${host.name} to start a new game…` : 'Waiting for the host to start a new game…'}
          </p>
        )}
        <button className="btn-link on-desk final-leave" onClick={onLeave}>
          Leave
        </button>
      </div>
    </div>
  )
}
