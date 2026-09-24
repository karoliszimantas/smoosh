import { useState } from 'react'
import type { GameConnection, ConnectionStatus } from './useGameConnection'

export default function HomeView({
  emit,
  connectionStatus,
}: {
  emit: GameConnection['emit']
  connectionStatus: ConnectionStatus
}) {
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [name, setName] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
    if (!res.ok) setError(res.message)
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
    if (!res.ok) setError(res.message)
  }

  return (
    <div className="home-view">
      <h1>smoosh</h1>
      {connectionStatus !== 'connected' && <p className="home-status">Connecting…</p>}

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

      <button disabled={busy || connectionStatus !== 'connected'} onClick={() => void (mode === 'create' ? handleCreate() : handleJoin())}>
        {mode === 'create' ? 'Create' : 'Join'}
      </button>
    </div>
  )
}
