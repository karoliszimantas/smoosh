import { useState } from 'react'

// Tucked behind a tap, away from anything that submits — leaving is never
// something to do by accident. In a round it sits at the end of the status
// strip, small (`inStrip`); elsewhere, in the top-right corner.
export default function GameMenu({
  roomCode,
  isLobby,
  onLeave,
  inStrip = false,
}: {
  roomCode: string
  isLobby: boolean
  onLeave: () => void
  inStrip?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className={inStrip ? 'game-menu in-strip' : 'game-menu'}>
      <button
        className={inStrip ? 'icon-btn icon-btn-sm game-menu-button' : 'icon-btn game-menu-button'}
        aria-label="Game menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width={inStrip ? 16 : 20} height={inStrip ? 16 : 20} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
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
