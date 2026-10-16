import { useRef, useState } from 'react'
import Wordmark from './Wordmark'
import DymoLabel from './DymoLabel'
import { copyText, inviteLink } from './invite'
import HowToPlay from './HowToPlay'

// Tucked behind a tap, away from anything that submits — leaving is never
// something to do by accident. Opens on the small wordmark and the room's
// code on its Dymo strip, the invite link to copy for a latecomer (only
// while one could get in: `canInvite`), how to play, then Leave. In a round it sits at the end of the status
// strip, small (`inStrip`); elsewhere, in the top-right corner.
export default function GameMenu({
  roomCode,
  isLobby,
  canInvite = false,
  onLeave,
  inStrip = false,
}: {
  roomCode: string
  isLobby: boolean
  canInvite?: boolean
  onLeave: () => void
  inStrip?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [howToPlay, setHowToPlay] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // the menu stays open to say how the copy went
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null)
  const copyInvite = async () => setCopied((await copyText(inviteLink(roomCode))) ? 'copied' : 'failed')
  return (
    <div className={inStrip ? 'game-menu in-strip' : 'game-menu'}>
      <button
        ref={buttonRef}
        className={inStrip ? 'icon-btn icon-btn-sm game-menu-button' : 'icon-btn game-menu-button'}
        aria-label="Game menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o)
          setCopied(null)
        }}
      >
        <svg width={inStrip ? 16 : 20} height={inStrip ? 16 : 20} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open && (
        <div className="paper-card game-menu-popover" role="menu">
          <div className="game-menu-head">
            <Wordmark size="sm" />
            <p className="game-menu-code">
              <span className="field-label on-paper" aria-hidden="true">
                Room
              </span>
              <DymoLabel code={roomCode} size="sm" />
            </p>
          </div>
          {canInvite && (
            <>
              <button className="btn btn-secondary btn-inset btn-block" role="menuitem" onClick={() => void copyInvite()}>
                Copy invite link
              </button>
              <p className="game-menu-status" role="status">
                {copied === 'copied' ? 'Link copied' : copied === 'failed' ? 'Couldn’t copy. Here’s the link:' : ''}
              </p>
              {copied === 'failed' && (
                <input
                  className="field game-menu-link"
                  aria-label="Invite link"
                  readOnly
                  value={inviteLink(roomCode)}
                  onFocus={(e) => e.currentTarget.select()}
                />
              )}
            </>
          )}
          <button
            className="btn btn-secondary btn-inset btn-block"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              setHowToPlay(true)
            }}
          >
            How to play
          </button>
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
      {/* the menu item is gone with the menu: focus goes back to ⋯ */}
      {howToPlay && <HowToPlay onClose={() => setHowToPlay(false)} returnFocus={() => buttonRef.current} />}
    </div>
  )
}
