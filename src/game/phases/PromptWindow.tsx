import { useState } from 'react'
import type { RoomSnapshot } from '@smoosh/protocol'
import type { GameConnection } from '../useGameConnection'
import { useCountdown } from '../useCountdown'

type Build = NonNullable<RoomSnapshot['you']['build']>

// The first seconds of a Guess build, before this player's clock starts:
// their prompt, the one chance to swap it, and "start building". After a
// swap both prompts are shown and they keep either — the swap pays for the
// look, so going back to the first costs nothing more.
export default function PromptWindow({
  round,
  prompt,
  build,
  emit,
}: {
  round: number
  prompt: string
  build: Build
  emit: GameConnection['emit']
}) {
  const { remainingMs } = useCountdown(build.windowEndsAt)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (build.windowEndsAt === null || remainingMs <= 0) return null

  const send = async (run: () => Promise<{ ok: boolean; message?: string }>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await run()
    setBusy(false)
    if (!res.ok) setError(res.message ?? 'Try again.')
  }
  const seconds = Math.ceil(remainingMs / 1000)

  return (
    <div className="prompt-window" role="dialog" aria-modal="true" aria-label="Your prompt">
      <div className="prompt-window-card">
        {build.offered === null ? (
          <>
            <p className="prompt-window-kicker">Your prompt</p>
            <h2 className="prompt-window-prompt">{prompt}</h2>
            <button className="prompt-window-start" onClick={() => void send(() => emit('build:begin', { round }))} disabled={busy}>
              Start building
            </button>
            {build.canSwap ? (
              <button className="prompt-window-swap" onClick={() => void send(() => emit('prompt:swap', { round }))} disabled={busy}>
                Swap prompt · {build.swapsLeft} left
              </button>
            ) : (
              <p className="prompt-window-note">
                {build.swapsLeft === 0 ? 'No swaps left this game' : 'No swaps this round'}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="prompt-window-kicker">Pick the one you’ll build</p>
            {(
              [
                ['original', prompt],
                ['swapped', build.offered],
              ] as const
            ).map(([keep, text]) => (
              <button
                key={keep}
                className="prompt-window-choice"
                onClick={() => void send(() => emit('prompt:keep', { round, keep }))}
                disabled={busy}
              >
                {text}
              </button>
            ))}
            <p className="prompt-window-note">Both are out of the game now, whichever you keep</p>
          </>
        )}
        {error && <p className="form-error">{error}</p>}
        <p className="prompt-window-clock">Your clock starts in {seconds}s</p>
      </div>
    </div>
  )
}
