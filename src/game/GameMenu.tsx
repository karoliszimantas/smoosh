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
        className="icon-btn game-menu-button"
        aria-label="Game menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open && (
        <div className="paper-card game-menu-popover" role="menu">
          <p className="field-label on-paper">Game {roomCode}</p>
          <button
            className="btn btn-secondary btn-inset btn-block"
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
