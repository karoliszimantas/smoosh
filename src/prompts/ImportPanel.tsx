import { useMemo, useState, type ChangeEvent } from 'react'
import { MAX_IMPORT_ROWS, MAX_PROMPT_AUTHOR_LENGTH } from '@smoosh/protocol'
import { PromptApiError, promptApi, type Prompt, type PromptMode } from './api'
import { parseImport, previewImport, summarize, type RowStatus } from './importParse'

const MODE_LABEL: Record<PromptMode, string> = { both: 'Both', guess: 'Guess', gallery: 'Gallery' }
const STATUS_LABEL: Record<RowStatus, string> = {
  new: 'New',
  duplicate: 'Duplicate',
  too_long: 'Too long',
  invalid: 'Invalid',
}
// a spreadsheet of prompts is a few kilobytes; this is only a guard
const MAX_FILE_BYTES = 1_000_000

type Props = {
  pool: readonly Prompt[]
  me: string
  onImported: (result: { prompts: Prompt[]; added: string[] }) => void
  // a failure the page handles itself (a wrong code goes back to the gate)
  onAuthFail: (err: unknown) => void
  // fetch the pool again — after a refusal, the preview should judge
  // against what's really there now
  onRefresh: () => void
  onClose: () => void
}

// Paste (or pick a file), see what would happen, untick anything unwanted,
// import. Nothing is sent until the Import button.
export default function ImportPanel({ pool, me, onImported, onAuthFail, onRefresh, onClose }: Props) {
  const [input, setInput] = useState('')
  const [importAllAs, setImportAllAs] = useState('')
  // rows unticked by hand; every new row starts ticked
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rows = useMemo(() => previewImport(parseImport(input).rows, pool, { me, importAllAs }), [input, pool, me, importAllAs])
  const chosen = rows.filter((r) => r.status === 'new' && !excluded.has(r.id))
  const newCount = rows.filter((r) => r.status === 'new').length
  const tooMany = chosen.length > MAX_IMPORT_ROWS

  const canPaste = 'clipboard' in navigator && typeof navigator.clipboard.readText === 'function'
  const paste = () => {
    navigator.clipboard.readText().then(
      (text) => {
        setInput(text)
        setError(null)
      },
      () => setError('Couldn’t read the clipboard — long-press the box below and paste there instead.'),
    )
  }

  const pickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // picking the same file again still fires
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setError('That file is too big to be a list of prompts.')
      return
    }
    file.text().then(
      (text) => {
        setInput(text)
        setError(null)
      },
      () => setError('Couldn’t read that file.'),
    )
  }

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const commit = () => {
    if (chosen.length === 0 || tooMany || busy) return
    setBusy(true)
    setError(null)
    promptApi
      .import(chosen.map((r) => ({ text: r.text, mode: r.mode, author: r.author })))
      .then(onImported, (err: unknown) => {
        if (err instanceof PromptApiError && err.code === 'wrong_code') {
          onAuthFail(err)
          return
        }
        setError(err instanceof Error ? err.message : 'Something went wrong. Nothing was imported.')
        onRefresh()
      })
      .finally(() => setBusy(false))
  }

  return (
    <div className="prompts-import" role="dialog" aria-modal="true" aria-label="Import prompts">
      <div className="prompts-import-head">
        <h2>Import prompts</h2>
        <button onClick={onClose}>Close</button>
      </div>

      <div className="prompts-import-sources">
        {canPaste && (
          <button className="prompts-primary" onClick={paste}>
            Paste
          </button>
        )}
        <label className="prompts-file">
          Choose file…
          <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={pickFile} />
        </label>
      </div>
      <textarea
        className="prompts-import-input"
        value={input}
        onChange={(e) => {
          setInput(e.target.value)
          setError(null)
        }}
        placeholder={'Paste here — one prompt per line, or a spreadsheet with a “text” column (and optional “mode” and “author”).'}
        rows={5}
        aria-label="Prompts to import"
        spellCheck={false}
      />
      <label className="prompts-import-as">
        Import all as
        <input
          value={importAllAs}
          onChange={(e) => setImportAllAs(e.target.value)}
          placeholder={`each row’s author, or ${me}`}
          maxLength={MAX_PROMPT_AUTHOR_LENGTH}
          autoCapitalize="off"
        />
      </label>

      {rows.length > 0 && (
        <div className="prompts-import-counts">
          <span>{summarize(rows)}</span>
          {newCount > 0 && (
            <button onClick={() => setExcluded(chosen.length > 0 ? new Set(rows.map((r) => r.id)) : new Set())}>
              {chosen.length > 0 ? 'Untick all' : 'Tick all new'}
            </button>
          )}
        </div>
      )}

      <ul className="prompts-import-rows">
        {rows.map((r) => {
          const selectable = r.status === 'new'
          return (
            <li key={r.id}>
              <label className={`import-row ${r.status}`}>
                <input
                  type="checkbox"
                  className="prompt-select"
                  checked={selectable && !excluded.has(r.id)}
                  disabled={!selectable}
                  onChange={() => toggle(r.id)}
                />
                <span className="prompt-body">
                  <span className="prompt-text">{r.text || '—'}</span>
                  <span className="prompt-meta">
                    line {r.line} · <span className="prompt-badge">{MODE_LABEL[r.mode]}</span> · {r.author} ·{' '}
                    <span className={`import-status ${r.status}`}>{STATUS_LABEL[r.status]}</span>
                  </span>
                  {r.reason && <span className="import-reason">{r.reason}</span>}
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      <div className="prompts-import-bar">
        {error && <p className="prompts-error">{error}</p>}
        {tooMany && (
          <p className="prompts-error">
            At most {MAX_IMPORT_ROWS} prompts in one import — untick {chosen.length - MAX_IMPORT_ROWS}, or split the list.
          </p>
        )}
        <button className="prompts-primary" onClick={commit} disabled={chosen.length === 0 || tooMany || busy}>
          {busy ? 'Importing…' : `Import ${chosen.length} prompt${chosen.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  )
}
