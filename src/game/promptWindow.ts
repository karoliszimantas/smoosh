import { useEffect, useState } from 'react'
import type { RoomSnapshot } from '@smoosh/protocol'

// When this player's prompt window closes, while it's open: the first
// seconds of a build, before their own clock starts, when they read their
// secret prompt (and may swap it). Null when there's no window to show.
export function promptWindowEndsAt(snapshot: RoomSnapshot | null): number | null {
  if (!snapshot || snapshot.phase.phase !== 'build' || snapshot.you.hasActedThisPhase) return null
  return snapshot.you.build?.windowEndsAt ?? null
}

// true until `endsAt`, then false — re-rendering once, when it passes,
// rather than on every tick of a clock
export function useBefore(endsAt: number | null): boolean {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (endsAt === null) return
    const id = window.setTimeout(() => setNow(Date.now()), Math.max(0, endsAt - Date.now()) + 1)
    return () => window.clearTimeout(id)
  }, [endsAt])
  return endsAt !== null && now < endsAt
}
