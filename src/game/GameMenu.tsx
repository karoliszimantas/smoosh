import { useState } from 'react'

// Tucked in a corner behind a tap, away from anything that submits —
// leaving is never something to do by accident.
export default function GameMenu({
  roomCode,
  isLobby,
  onLeave,
}: {
  roomCode: string
  isLobby: boolean
  onLeave: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="game-menu">
      <button
        className="game-menu-button"
        aria-label="Game menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <div className="game-menu-popover" role="menu">
          <p className="game-menu-code">Game {roomCode}</p>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onLeave()
            }}
          >
            {isLobby ? 'Leave room' : 'Leave game'}
          </button>
        </div>
      )}
    </div>
  )
}
