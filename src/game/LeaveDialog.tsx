import { leaveDialogText } from './roomMessages'

export default function LeaveDialog({
  roomCode,
  isLobby,
  isHost,
  onLeave,
  onStay,
}: {
  roomCode: string
  isLobby: boolean
  isHost: boolean
  onLeave: () => void
  onStay: () => void
}) {
  const { title, body } = leaveDialogText({ roomCode, isLobby, isHost })
  return (
    <div className="leave-scrim" onClick={onStay}>
      <div
        className="leave-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="leave-title">{title}</h2>
        <p>{body}</p>
        <div className="leave-actions">
          <button className="btn btn-primary btn-inset leave-stay" onClick={onStay} autoFocus>
            Stay
          </button>
          <button className="btn btn-secondary btn-inset leave-go" onClick={onLeave}>
            Leave
          </button>
        </div>
      </div>
    </div>
  )
}
