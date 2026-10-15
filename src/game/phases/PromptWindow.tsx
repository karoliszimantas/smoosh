import { useState } from 'react'
import type { ErrorCode, RoomSnapshot } from '@smoosh/protocol'
import type { GameConnection } from '../useGameConnection'
import { actionErrorText } from '../roomMessages'
import PromptChips from '../PromptChips'
import Tape from '../../components/Tape'

type Build = NonNullable<RoomSnapshot['you']['build']>

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c5.5 0 9 7 9 7a16 16 0 0 1-2.6 3.4" />
      <path d="M6.6 6.6C4.3 8.2 3 12 3 12s3.5 7 9 7a9 9 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  )
}

// The first seconds of a Guess build, before this player's clock starts:
// their prompt, the one chance to swap it, and "start building". After a
// swap both prompts are shown and they keep either — the swap pays for the
// look, so going back to the first costs nothing more.
//
// A torn paper card taped to the desk, filling the screen under the header
// (PromptWindowHeader, which says when the clock starts). BuildView shows it
// only while the window is open.
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async (run: () => Promise<{ ok: true } | { ok: false; code: ErrorCode }>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await run()
    setBusy(false)
    if (!res.ok) setError(actionErrorText(res.code))
  }

  return (
    <div className="prompt-window" role="dialog" aria-labelledby="prompt-window-title">
      <div className="prompt-window-sheet">
        {/* the shadow is a filter on this wrapper, so it follows the torn edge */}
        <div className="prompt-window-shadow">
          <section className="prompt-window-card">
            {build.offered === null ? (
              <>
                <div className="prompt-window-top">
                  <h1 id="prompt-window-title" className="prompt-window-kicker">
                    Your secret prompt
                  </h1>
                  <PromptChips prompt={prompt} />
                  <p className="prompt-window-private">
                    <EyeOffIcon />
                    Only you can see this
                  </p>
                </div>
                <div className="prompt-window-actions">
                  {error && <p className="form-error">{error}</p>}
                  <button
                    className="btn btn-primary btn-inset btn-block prompt-window-start"
                    onClick={() => void send(() => emit('build:begin', { round }))}
                    disabled={busy}
                  >
                    Start building
                  </button>
                  {build.canSwap ? (
                    <button
                      className="btn btn-secondary btn-inset btn-block prompt-window-swap"
                      onClick={() => void send(() => emit('prompt:swap', { round }))}
                      disabled={busy}
                    >
                      Swap · {build.swapsLeft} left
                    </button>
                  ) : (
                    <p className="prompt-window-note">
                      {build.swapsLeft === 0 ? 'No swaps left this game' : 'No swaps this round'}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="prompt-window-top">
                  <h1 id="prompt-window-title" className="prompt-window-kicker">
                    Pick the one you’ll build
                  </h1>
                </div>
                <div className="prompt-window-actions">
                  {error && <p className="form-error">{error}</p>}
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
                </div>
              </>
            )}
          </section>
        </div>
        <Tape y={-8} />
      </div>
    </div>
  )
}
