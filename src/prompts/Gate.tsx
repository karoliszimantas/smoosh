import { useState, type FormEvent } from 'react'
import { getCode, getName, setCode, setName } from './access'

// First visit only: the access code (unless a link brought it) and a name.
// After this, never asked again.
// Shared by /prompts and /labels — one code and one name for both.
export default function Gate({ title, error, onDone }: { title: string; error: string | null; onDone: () => void }) {
  const [code, setCodeDraft] = useState(getCode())
  const [name, setNameDraft] = useState(getName())
  const needCode = !getCode() || error !== null
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (needCode && !code.trim()) return
    if (!name.trim()) return
    if (needCode) setCode(code)
    setName(name)
    onDone()
  }
  return (
    <form className="prompts-gate" onSubmit={submit}>
      <h1>{title}</h1>
      {needCode && (
        <label>
          Access code
          <input value={code} onChange={(e) => setCodeDraft(e.target.value)} autoCapitalize="off" autoComplete="off" />
        </label>
      )}
      <label>
        Your name
        <input value={name} onChange={(e) => setNameDraft(e.target.value)} maxLength={24} autoComplete="nickname" />
      </label>
      {error && <p className="prompts-error">{error}</p>}
      <button type="submit">Continue</button>
    </form>
  )
}

