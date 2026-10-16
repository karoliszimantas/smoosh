// how long before the clock runs out the player is told their picture is
// about to go by itself
export const AUTO_SEND_WARN_MS = 10_000

// whole seconds until Build sends the picture by itself, counting down
// from 10 in the last ten seconds; null before then, and once it's gone
export function autoSendSeconds(remainingMs: number): number | null {
  if (remainingMs <= 0 || remainingMs > AUTO_SEND_WARN_MS) return null
  return Math.ceil(remainingMs / 1000)
}

export const autoSendText = (seconds: number) => `Sending what you have in ${seconds}…`
