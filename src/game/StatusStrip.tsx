import { useLayoutEffect, useRef } from 'react'
import type { RoomSnapshot } from '@smoosh/protocol'
import ThemeSwitcher from '../themes/ThemeSwitcher'
import DoneDots from './DoneDots'
import GameMenu from './GameMenu'
import TimerTag from './TimerTag'
import type { StatusLine } from './statusLine'

// Across the top of every round screen, on the desk: where the game is, the
// clock on its tag, who's done — and the light/dark switch and the menu,
// which live here in a round rather than floating in the corners.
export default function StatusStrip({
  snapshot,
  status,
  onLeave,
}: {
  snapshot: RoomSnapshot
  status: StatusLine
  onLeave: () => void
}) {
  // the strip's height, as --status-strip-h on the page, for what places
  // itself under the strip from outside it (the notices). It changes when
  // the done-dots wrap to a second row
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const strip = ref.current
    if (!strip) return
    const root = document.documentElement
    const measure = () => root.style.setProperty('--status-strip-h', `${strip.offsetHeight}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(strip)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--status-strip-h')
    }
  }, [])

  return (
    <header className="status-strip" ref={ref}>
      <p className="status-where">
        <span>{status.round}</span> <span className="status-step">{status.step}</span>
      </p>
      <TimerTag key={status.key} deadline={status.deadline} durationSec={status.durationSec} word={status.word} />
      <div className="status-side">
        <div className="status-tools">
          <ThemeSwitcher variant="strip" />
          <GameMenu roomCode={snapshot.roomCode} isLobby={false} onLeave={onLeave} inStrip />
        </div>
        <DoneDots snapshot={snapshot} />
      </div>
    </header>
  )
}
