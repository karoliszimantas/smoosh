import { useCallback, useEffect, useState, type RefObject } from 'react'
import type { RoomSnapshot } from '@smoosh/protocol'
import { devLog } from './useGameConnection'

// The phases where the room waits on players to do something
const ACTION_PHASES = new Set(['build', 'lie', 'guess', 'vote', 'pass', 'chainVote'])
// stuck for this long, continuously, before it's said — long enough that a
// screen mid-render or mid-transition never trips it
export const STUCK_AFTER_MS = 10_000

// the server is waiting on this player to act, by its own record
export function expectsAction(snapshot: RoomSnapshot): boolean {
  return (
    ACTION_PHASES.has(snapshot.phase.phase) &&
    !snapshot.you.hasActedThisPhase &&
    snapshot.waitingOn.includes(snapshot.you.playerId)
  )
}

// …and nothing on their screen lets them: the one state a player can't get
// out of by looking harder
export function isStuck(snapshot: RoomSnapshot, enabledControls: number): boolean {
  return expectsAction(snapshot) && enabledControls === 0
}

const CONTROLS = 'button, input, textarea, select, [role="button"]'

// controls in the phase's screen a finger could use
export function countEnabledControls(root: ParentNode): number {
  let n = 0
  for (const el of root.querySelectorAll<HTMLElement>(CONTROLS)) {
    if (el.matches(':disabled') || el.closest('[inert], [aria-hidden="true"]')) continue
    if (el.getClientRects().length === 0) continue // not laid out: hidden
    n++
  }
  return n
}

// True once the server has been waiting on this player, with nothing on
// their screen to press, for STUCK_AFTER_MS straight. Checked by polling
// the rendered screen, not by trusting any one view to report itself —
// what's wrong may be exactly that a view renders without its controls.
// `reset`: start over — after Rejoin, it takes another STUCK_AFTER_MS of
// a dead screen to say so again.
export function useStuckWatchdog(
  snapshot: RoomSnapshot | null,
  root: RefObject<HTMLElement | null>,
): { stuck: boolean; reset: () => void } {
  // the snapshot it was raised for: a fresh one (the phase moving on)
  // clears it, and it's raised again only if that one is stuck too
  const [stuckOn, setStuckOn] = useState<RoomSnapshot | null>(null)
  const [epoch, setEpoch] = useState(0)
  const reset = useCallback(() => {
    setStuckOn(null)
    setEpoch((n) => n + 1)
  }, [])
  useEffect(() => {
    if (!snapshot || !expectsAction(snapshot)) return
    let since: number | null = null
    const check = () => {
      const el = root.current
      const controls = el ? countEnabledControls(el) : 0
      if (!isStuck(snapshot, controls)) {
        since = null
        setStuckOn(null)
        return
      }
      since ??= Date.now()
      if (Date.now() - since >= STUCK_AFTER_MS) {
        setStuckOn((was) => {
          if (was !== snapshot) devLog('stuck: waited on, nothing to press', { phase: snapshot.phase.phase, controls })
          return snapshot
        })
      }
    }
    const timer = setInterval(check, 1000)
    return () => clearInterval(timer)
  }, [snapshot, root, epoch])
  return { stuck: snapshot !== null && stuckOn === snapshot, reset }
}
