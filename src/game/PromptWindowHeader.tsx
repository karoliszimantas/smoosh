import type { RoomSnapshot } from '@smoosh/protocol'
import ThemeSwitcher from '../themes/ThemeSwitcher'
import GameMenu from './GameMenu'
import { useCountdown } from './useCountdown'

// Over the prompt window, in place of the status strip: nothing is timed
// yet, so no tag — where the game is, when this player's clock starts, and
// the same light/dark switch and menu as the strip.
export default function PromptWindowHeader({
  snapshot,
  round,
  windowEndsAt,
  onLeave,
}: {
  snapshot: RoomSnapshot
  round: string
  windowEndsAt: number
  onLeave: () => void
}) {
  const { remainingMs } = useCountdown(windowEndsAt)
  const seconds = Math.ceil(remainingMs / 1000)
  return (
    <header className="status-strip prompt-window-header">
      <p className="prompt-window-where">{round}</p>
      <div className="prompt-window-side">
        <p className="prompt-window-clock">
          Clock starts in <span className="prompt-window-seconds">{seconds} s</span>
        </p>
        <div className="status-tools">
          <ThemeSwitcher variant="strip" />
          <GameMenu roomCode={snapshot.roomCode} isLobby={false} onLeave={onLeave} inStrip />
        </div>
      </div>
    </header>
  )
}
