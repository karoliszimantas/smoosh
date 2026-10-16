import { useEffect, useState } from 'react'
import DymoLabel from './DymoLabel'
import Tape from '../components/Tape'
import InviteQr from './InviteQr'
import { copyText, inviteLink, shareInvite } from './invite'

// how long "Link copied" stays
const COPIED_MS = 2500

// The Lobby's room code, on its own taped paper card (Lobby.dc.html), and
// the ways to hand it on: tap the code for a QR code to scan across the
// table, or send the link — copied, or through the phone's share sheet.
export default function RoomCodeCard({ roomCode }: { roomCode: string }) {
  const [qrOpen, setQrOpen] = useState(false)
  // said once in the live region below the buttons; on a failed copy the
  // link itself is shown, to copy by hand
  const [status, setStatus] = useState<'copied' | 'failed' | null>(null)

  useEffect(() => {
    if (status !== 'copied') return
    const timer = setTimeout(() => setStatus(null), COPIED_MS)
    return () => clearTimeout(timer)
  }, [status])

  const copy = async () => setStatus((await copyText(inviteLink(roomCode))) ? 'copied' : 'failed')
  const share = async () => {
    const res = await shareInvite(roomCode)
    if (res === 'copied' || res === 'failed') setStatus(res)
  }

  return (
    <div className="paper-card lobby-code">
      {/* the room's heading is its code, spelled out: the label above is
          for the eye only, the button names the code */}
      <p className="field-label on-paper" aria-hidden="true">
        Room code · tap for QR
      </p>
      <h1 className="lobby-code-heading">
        <button
          className="lobby-code-button"
          aria-label={`Show QR code for room ${[...roomCode].join(' ')}`}
          onClick={() => setQrOpen(true)}
        >
          <DymoLabel code={roomCode} />
        </button>
      </h1>
      <div className="lobby-invite">
        <button className="btn btn-secondary btn-inset" onClick={() => void copy()}>
          Copy link
        </button>
        <button className="btn btn-secondary btn-inset" onClick={() => void share()}>
          Share
        </button>
      </div>
      <p className="lobby-invite-status" role="status">
        {status === 'copied' ? 'Link copied' : status === 'failed' ? 'Couldn’t copy. Here’s the link:' : ''}
      </p>
      {status === 'failed' && (
        <input
          className="field lobby-invite-link"
          aria-label="Invite link"
          readOnly
          value={inviteLink(roomCode)}
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
      <Tape />
      {qrOpen && <InviteQr roomCode={roomCode} onClose={() => setQrOpen(false)} />}
    </div>
  )
}
