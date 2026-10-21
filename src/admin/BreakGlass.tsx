import { useState, type FormEvent } from 'react'
import { AdminApiError, adminCall } from './api'

// /admin/break-glass — for when Google sign-in is broken and the game still
// needs looking after. Nothing links here; ADMIN.md says where it is. The
// server logs every use, and every request the session makes, loudly, and
// the session lasts an hour.
export default function BreakGlass() {
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!token.trim() || busy) return
    setBusy(true)
    setError(null)
    adminCall<{ ok: true }>('POST', '/auth/break-glass', { token: token.trim() }).then(
      () => window.location.assign('/admin'),
      (err: unknown) => {
        setBusy(false)
        setError(err instanceof AdminApiError ? err.message : 'That didn’t work.')
      },
    )
  }

  return (
    <div className="prompts-view">
      <form className="prompts-gate admin-gate" onSubmit={submit}>
        <h1>Break glass</h1>
        <p className="labels-hint">
          The last resort, for when Google sign-in is broken. Every use is logged loudly on the server, and the
          session ends after an hour.
        </p>
        <label>
          Break-glass token
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {error && <p className="prompts-error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Checking…' : 'Open admin'}
        </button>
      </form>
    </div>
  )
}
