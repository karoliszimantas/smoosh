import type { RoomSnapshot } from '@smoosh/protocol'
import PlayerDot from './PlayerDot'

// Who's playing, along the bottom of the screens between pictures: a dot
// per player, someone away faded — quietly, not an alarm. Each dot is named
// for its player ("Bob, away"; yours is "You"). Players who left are gone
// from it; the room was told when they went.
export default function PresenceStrip({ snapshot }: { snapshot: RoomSnapshot }) {
  const players = snapshot.players.filter((p) => p.presence !== 'left')
  return (
    <ul className="presence-strip" aria-label="Players">
      {players.map((p) => (
        <li key={p.id}>
          <PlayerDot
            player={p}
            players={snapshot.players}
            away={p.presence === 'away'}
            youId={snapshot.you.playerId}
          />
        </li>
      ))}
    </ul>
  )
}
