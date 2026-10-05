import { useState } from 'react'
import type { GameConnection, ConnectionStatus } from './useGameConnection'
import { getActiveRoom } from './session'
import { joinFailedText } from './roomMessages'

export default function HomeView({
  emit,
  connectionStatus,
  onSandbox,
  notice,
  lastRoomCode,
}: {
  emit: GameConnection['emit']
  connectionStatus: ConnectionStatus
  onSandbox: () => void
  // why they're here, if it's not their first visit — calm, not an error
  notice: string | null
  // the game they were last in, ready to join again
  lastRoomCode: string | null
}) {
  const [mode, setMode] = useState<'create' | 'join'>(lastRoomCode ? 'join' : 'create')
  const [name, setName] = useState('')
  const [roomCode, setRoomCode] = useState(lastRoomCode ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // still seated in a live game, but heading for a different one
  const [stillIn, setStillIn] = useState<{ roomCode: string; proceed: () => void } | null>(null)

  // starting something new while a game is still holding a seat: ask once
  const guard = (target: string | null, proceed: () => void) => {
    const active = getActiveRoom()
    if (active && active.roomCode !== target) setStillIn({ roomCode: active.roomCode, proceed })
    else proceed()
  }

  const rejoin = async () => {
    const active = getActiveRoom()
    setStillIn(null)
    if (!active) return
    setBusy(true)
    const res = await emit('room:join', { roomCode: active.roomCode, name: active.name })
    setBusy(false)
    if (!res.ok) setError(joinFailedText(active.roomCode, res.code))
  }

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter a name')
      return
    }
    setBusy(true)
    setError(null)
    const res = await emit('room:create', { name: trimmed })
    setBusy(false)
    if (!res.ok) setError('Couldn’t start a game. Try again?')
  }

  const handleJoin = async () => {
    const trimmed = name.trim()
    const code = roomCode.trim().toUpperCase()
    if (!trimmed || code.length !== 4) {
      setError('Enter a name and the 4-letter room code')
      return
    }
    setBusy(true)
    setError(null)
    const res = await emit('room:join', { roomCode: code, name: trimmed })
    setBusy(false)
    if (!res.ok) setError(joinFailedText(code, res.code))
  }

  return (
    <div className="home-view">
      <h1>smoosh</h1>
      {connectionStatus !== 'connected' && <p className="home-status">Connecting…</p>}
      {notice && <p className="home-notice">{notice}</p>}

      <div className="home-tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'create'} className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>
          Create game
        </button>
        <button role="tab" aria-selected={mode === 'join'} className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>
          Join game
        </button>
      </div>

      <input placeholder="Your name" maxLength={12} value={name} onChange={(e) => setName(e.target.value)} />

      {mode === 'join' && (
        <input
          placeholder="Room code"
          maxLength={4}
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
        />
      )}

      {error && <p className="home-error">{error}</p>}

      {stillIn ? (
        <div className="home-still-in" role="alertdialog" aria-label="Still in a game">
          <p>You’re still in game {stillIn.roomCode}. Rejoin, or start fresh?</p>
          <div className="home-still-in-actions">
            <button onClick={() => void rejoin()}>Rejoin</button>
            <button
              className="home-secondary"
              onClick={() => {
                const { proceed } = stillIn
                setStillIn(null)
                proceed()
              }}
            >
              Start fresh
            </button>
          </div>
        </div>
      ) : (
        <button
          disabled={busy || connectionStatus !== 'connected'}
          onClick={() =>
            mode === 'create'
              ? guard(null, () => void handleCreate())
              : guard(roomCode.trim().toUpperCase(), () => void handleJoin())
          }
        >
          {mode === 'create' ? 'Create' : 'Join'}
        </button>
      )}

      {/* a utility, not the main path — and never gated on the connection:
          it has to work with the game server down */}
      <button className="home-secondary" onClick={onSandbox}>
        Just mess around
      </button>
    </div>
  )
}
