// A guess picked but never locked in is sent for the player as time runs
// out, the same as tapping Lock in.
//
// The server takes no late guesses: GUESS ends on its own timer at the
// deadline (phaseMachine startGuess → advanceCurrentPhase), with no grace
// like BUILD's, and from then on guess:submit is refused as PHASE_MISMATCH.
// So the send goes out a second early, to land before the phase closes:
// a slow phone link takes a few hundred milliseconds one way, and the
// deadline is the server's clock read against this phone's, uncorrected,
// as the timer tag reads it. A pick made inside that last second is sent at
// once.
export const AUTO_LOCK_LEAD_MS = 1000

// Arms the send for `deadline` and returns the way to disarm it — for an
// effect's cleanup, so a lock-in, a phase change or leaving the screen
// cancels it. Nothing is armed without a pick to send (`armed` false: no
// pick, already locked, or the picture's own author) or a deadline.
export function scheduleAutoLock(
  deadline: number | null,
  armed: boolean,
  send: () => void,
  now: number = Date.now(),
): (() => void) | undefined {
  if (!armed || deadline === null) return undefined
  const id = setTimeout(send, Math.max(0, deadline - AUTO_LOCK_LEAD_MS - now))
  return () => clearTimeout(id)
}
