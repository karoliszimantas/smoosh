// above any phase, until dismissed — news the player must not miss whatever
// screen they are on, e.g. their picture was refused after the round moved on
export default function GameNotice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="game-notice" role="alert">
      <span>{message}</span>
      <button aria-label="Dismiss" onClick={onDismiss}>
        ✕
      </button>
    </div>
  )
}
