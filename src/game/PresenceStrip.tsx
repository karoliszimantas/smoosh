import type { RoomSnapshot } from '@smoosh/protocol'

// Who's playing, along the bottom of the screens between pictures: someone
// away is dimmed and marked, quietly — not an alarm. Players who left are
// gone from it; the room was told when they went.
export default function PresenceStrip({ snapshot }: { snapshot: RoomSnapshot }) {
  const players = snapshot.players.filter((p) => p.presence !== 'left')
  return (
    <ul className="presence-strip" aria-label="Players">
      {players.map((p) => (
        <li key={p.id} className={p.presence === 'away' ? 'away' : ''}>
          {p.id === snapshot.you.playerId ? 'You' : p.name}
          {p.presence === 'away' && <span className="away-marker">away</span>}
        </li>
      ))}
    </ul>
  )
}
