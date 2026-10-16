import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { encodeText } from './qrCode'
import { inviteLink } from './invite'
import { useDialog } from './useDialog'
import QrSvg from './QrSvg'
import DymoLabel from './DymoLabel'
import Tape from '../components/Tape'

// The invite link as a QR code, filling the screen for the people in the
// same room to scan off the host's phone; the code itself large under it
// for anyone typing it in. A tap anywhere, Close or Esc puts it away.
export default function InviteQr({ roomCode, onClose }: { roomCode: string; onClose: () => void }) {
  const link = inviteLink(roomCode)
  const qr = useMemo(() => encodeText(link, 'M'), [link])
  const ref = useDialog<HTMLDivElement>(onClose)

  return createPortal(
    <div
      ref={ref}
      className="invite-qr"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-qr-title"
      tabIndex={-1}
      onClick={onClose}
    >
      <h2 id="invite-qr-title" className="field-label">
        Scan to join
      </h2>
      <div className="paper-card invite-qr-card">
        <QrSvg qr={qr} label={`QR code of the invite link, ${link}`} />
        <Tape />
      </div>
      <DymoLabel code={roomCode} />
      <button
        className="btn btn-secondary invite-qr-close"
        data-autofocus
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        Close
      </button>
    </div>,
    document.body,
  )
}
