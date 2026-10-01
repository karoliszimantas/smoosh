import { useState } from 'react'
import GameRoot from './game/GameRoot'
import SandboxView from './sandbox/SandboxView'
import ErrorBoundary from './components/ErrorBoundary'

// Remembered per tab so a reload in the sandbox stays in the sandbox.
const MODE_KEY = 'smoosh_mode'

type Mode = 'game' | 'sandbox'

function loadMode(): Mode {
  try {
    return sessionStorage.getItem(MODE_KEY) === 'sandbox' ? 'sandbox' : 'game'
  } catch {
    return 'game'
  }
}

function saveMode(mode: Mode): void {
  try {
    sessionStorage.setItem(MODE_KEY, mode)
  } catch {
    // best effort — a reload just lands on the home screen
  }
}

export default function App() {
  const [mode, setMode] = useState<Mode>(loadMode)

  const switchTo = (next: Mode) => {
    saveMode(next)
    setMode(next)
  }

  return (
    <ErrorBoundary>
      {/* GameRoot owns the socket. The sandbox renders instead of it, not
          inside it, so entering the sandbox unmounts — and closes — the
          connection, and the sandbox works with the game server down. */}
      {mode === 'sandbox' ? (
        <SandboxView onExit={() => switchTo('game')} />
      ) : (
        <GameRoot onSandbox={() => switchTo('sandbox')} />
      )}
    </ErrorBoundary>
  )
}
