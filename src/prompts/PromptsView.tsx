import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { getCode, getName, setCode } from './access'
import { PROMPT_MODES, PromptApiError, promptApi, score, voterKey, type Prompt, type PromptMode } from './api'
import { promptsAsTs } from './exportTs'
import { downloadCsv, promptsAsCsv } from './exportCsv'
import ImportPanel from './ImportPanel'
import PromptTestView from './PromptTestView'
import Gate from './Gate'

// Past this many, the list grows by a page at a time, so a phone stays quick
const PAGE_SIZE = 100

const MODE_LABEL: Record<PromptMode, string> = { both: 'Both', guess: 'Guess', gallery: 'Gallery' }

type Status = 'active' | 'archived' | 'all'
type Sort = 'newest' | 'score' | 'least'

export default function PromptsView() {
  const [ready, setReady] = useState(() => getCode() !== '' && getName() !== '')
  const [gateError, setGateError] = useState<string | null>(null)
  const [prompts, setPrompts] = useState<Prompt[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // the add form — stays focused across submissions
  const [text, setText] = useState('')
  const [mode, setMode] = useState<PromptMode>('both')
  const [addError, setAddError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // list state — survives a trip to the sandbox (this component stays mounted)
  const [status, setStatus] = useState<Status>('active')
  const [modeFilter, setModeFilter] = useState<PromptMode | 'all'>('all')
  const [authorFilter, setAuthorFilter] = useState('all')
  const [neverBuilt, setNeverBuilt] = useState(false)
  const [sort, setSort] = useState<Sort>('newest')
  const [search, setSearch] = useState('')
  const [shown, setShown] = useState(PAGE_SIZE)

  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [editing, setEditing] = useState<{ id: string; text: string; mode: PromptMode } | null>(null)
  const [exported, setExported] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  // the last import's prompts, marked in the list until the next one
  const [justAdded, setJustAdded] = useState<ReadonlySet<string>>(() => new Set())

  const [building, setBuilding] = useState<Prompt | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const savedScroll = useRef(0)

  const me = voterKey(getName())

  // any failed call: a wrong code sends you back to the gate, everything
  // else is a plain sentence at the top
  const fail = useCallback((err: unknown, show: (msg: string) => void = setNotice) => {
    if (err instanceof PromptApiError && err.code === 'wrong_code') {
      setCode('')
      setGateError(err.message)
      setReady(false)
      return
    }
    show(err instanceof Error ? err.message : 'Something went wrong. Try again.')
  }, [])

  const run = useCallback(
    (task: Promise<Prompt[]>, after?: () => void) => {
      task.then(
        (next) => {
          setPrompts(next)
          after?.()
        },
        (err: unknown) => fail(err),
      )
    },
    [fail],
  )

  const refresh = useCallback(() => {
    promptApi.list().then(
      (next) => {
        setPrompts(next)
        setLoadError(null)
      },
      (err: unknown) => fail(err, setLoadError),
    )
  }, [fail])

  useEffect(() => {
    if (ready) refresh()
  }, [ready, refresh])

  // coming back to the tab (or the phone) picks up everyone else's changes
  useEffect(() => {
    if (!ready) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [ready, refresh])

  // back from the sandbox or the import panel: exactly where the list was
  // (or, after an import, at the top where the new prompts are)
  useLayoutEffect(() => {
    if (!building && !importing && scrollRef.current) scrollRef.current.scrollTop = savedScroll.current
  }, [building, importing])

  const counts = useMemo(() => {
    const all = prompts ?? []
    const archived = all.filter((p) => p.archived).length
    return { active: all.length - archived, archived, negative: all.filter((p) => !p.archived && score(p) < 0) }
  }, [prompts])

  const authors = useMemo(() => [...new Set((prompts ?? []).map((p) => p.author))].sort(), [prompts])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = (prompts ?? []).filter(
      (p) =>
        (status === 'all' || (status === 'archived') === p.archived) &&
        (modeFilter === 'all' || p.mode === modeFilter) &&
        (authorFilter === 'all' || p.author === authorFilter) &&
        (!neverBuilt || p.buildCount === 0) &&
        (!q || p.text.toLowerCase().includes(q) || p.author.toLowerCase().includes(q)),
    )
    const newest = (a: Prompt, b: Prompt) => b.createdAt.localeCompare(a.createdAt)
    if (sort === 'score') list.sort((a, b) => score(b) - score(a) || newest(a, b))
    else if (sort === 'least') list.sort((a, b) => a.buildCount - b.buildCount || newest(a, b))
    else list.sort(newest)
    return list
  }, [prompts, status, modeFilter, authorFilter, neverBuilt, sort, search])

  const add = (e: FormEvent) => {
    e.preventDefault()
    const value = text
    if (!value.trim()) return
    setAddError(null)
    // the input stays enabled and focused: several prompts in a row, no taps
    inputRef.current?.focus()
    promptApi.add(value, mode).then(
      (next) => {
        setPrompts(next)
        // only clear what was submitted — they may already be typing the next one
        setText((current) => (current === value ? '' : current))
      },
      (err: unknown) => fail(err, setAddError),
    )
  }

  const build = (p: Prompt) => {
    savedScroll.current = scrollRef.current?.scrollTop ?? 0
    promptApi.built(p.id)
    setBuilding(p)
  }

  const finishBuild = (verdict: 1 | -1 | null) => {
    const p = building
    setBuilding(null)
    if (p && verdict !== null) run(promptApi.vote(p.id, verdict))
    else refresh() // picks up the new build count
  }

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const selectedPrompts = (prompts ?? []).filter((p) => selected.has(p.id))
  const endSelecting = () => {
    setSelecting(false)
    setSelected(new Set())
  }

  const bulk = (action: 'archive' | 'restore' | 'delete', ids: string[], message: string) => {
    if (ids.length === 0) return
    run(promptApi.bulk(ids, action), () => {
      setNotice(message)
      endSelecting()
    })
  }

  const deleteSelectedForever = () => {
    const ids = selectedPrompts.filter((p) => p.archived).map((p) => p.id)
    if (ids.length === 0) return
    if (!window.confirm(`Delete ${ids.length} prompt${ids.length === 1 ? '' : 's'} forever? This can't be undone.`)) return
    bulk('delete', ids, `Deleted ${ids.length} forever.`)
  }

  const copyAsTs = () => {
    const ts = promptsAsTs(prompts ?? [])
    navigator.clipboard.writeText(ts).then(
      () => {
        setNotice('Copied — paste it over src/sandbox/prompts.ts and review the diff.')
        setExported(null)
      },
      // no clipboard (permissions, older browser) — show it to copy by hand
      () => setExported(ts),
    )
  }

  // what's on screen, as a spreadsheet — the archived view exports archived
  const exportCsv = () => {
    const day = new Date().toISOString().slice(0, 10)
    downloadCsv(promptsAsCsv(visible), `smoosh-prompts-${status}-${day}.csv`)
  }

  // after an import: the list shows everything, newest first, so the new
  // prompts are right there at the top, marked
  const finishImport = ({ prompts: next, added }: { prompts: Prompt[]; added: string[] }) => {
    setPrompts(next)
    setJustAdded(new Set(added))
    setStatus('active')
    setModeFilter('all')
    setAuthorFilter('all')
    setNeverBuilt(false)
    setSearch('')
    setSort('newest')
    setShown(Math.max(PAGE_SIZE, added.length))
    setImporting(false)
    setNotice(`Imported ${added.length} prompt${added.length === 1 ? '' : 's'} — marked below.`)
    savedScroll.current = 0
  }

  const openImport = () => {
    savedScroll.current = scrollRef.current?.scrollTop ?? 0
    setImporting(true)
  }

  if (!ready) {
    return (
      <div className="prompts-view">
        <Gate
          title="Prompts"
          error={gateError}
          onDone={() => {
            setGateError(null)
            setReady(true)
          }}
        />
      </div>
    )
  }

  return (
    <>
      {building && <PromptTestView prompt={building.text} onDone={finishBuild} />}
      {importing && prompts && (
        <ImportPanel
          pool={prompts}
          me={getName()}
          onImported={finishImport}
          onAuthFail={(err) => fail(err)}
          onRefresh={refresh}
          onClose={() => setImporting(false)}
        />
      )}
      <div className="prompts-view" ref={scrollRef} hidden={building !== null || importing}>
        <form className="prompts-add" onSubmit={add}>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a prompt, press Enter"
            maxLength={120}
            enterKeyHint="send"
            aria-label="New prompt"
          />
          <select value={mode} onChange={(e) => setMode(e.target.value as PromptMode)} aria-label="Mode">
            {PROMPT_MODES.map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </form>
        {addError && <p className="prompts-error">{addError}</p>}

        <div className="prompts-summary">
          <span>
            {counts.active} active · {counts.archived} archived
          </span>
          <span className="prompts-summary-actions">
            <button onClick={openImport} disabled={!prompts}>
              Import prompts
            </button>
            <button onClick={exportCsv} disabled={visible.length === 0}>
              Export CSV
            </button>
            <button onClick={copyAsTs} disabled={!prompts}>
              Copy as TS
            </button>
          </span>
        </div>
        {notice && (
          <p className="prompts-notice" onClick={() => setNotice(null)}>
            {notice}
          </p>
        )}
        {loadError && <p className="prompts-error">{loadError}</p>}
        {exported && <textarea className="prompts-export" readOnly value={exported} rows={8} />}

        <div className="prompts-filters">
          <div className="prompts-status" role="radiogroup" aria-label="Status">
            {(['active', 'archived', 'all'] as const).map((s) => (
              <button key={s} role="radio" aria-checked={status === s} onClick={() => setStatus(s)}>
                {s === 'active' ? 'Active' : s === 'archived' ? 'Archived' : 'All'}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search text or author"
            aria-label="Search"
          />
          <div className="prompts-filter-row">
            <select value={modeFilter} onChange={(e) => setModeFilter(e.target.value as PromptMode | 'all')} aria-label="Filter by mode">
              <option value="all">Any mode</option>
              {PROMPT_MODES.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </select>
            <select value={authorFilter} onChange={(e) => setAuthorFilter(e.target.value)} aria-label="Filter by author">
              <option value="all">Anyone</option>
              {authors.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
              <option value="newest">Newest</option>
              <option value="score">Score</option>
              <option value="least">Least built</option>
            </select>
          </div>
          <label className="prompts-check">
            <input type="checkbox" checked={neverBuilt} onChange={(e) => setNeverBuilt(e.target.checked)} />
            Never built
          </label>
        </div>

        <div className="prompts-bulk">
          {selecting ? (
            <>
              <span>{selected.size} selected</span>
              <button onClick={() => bulk('archive', [...selected], `Archived ${selected.size}.`)} disabled={selected.size === 0}>
                Archive
              </button>
              <button onClick={() => bulk('restore', [...selected], `Restored ${selected.size}.`)} disabled={selected.size === 0}>
                Restore
              </button>
              {/* permanent delete only ever touches archived prompts */}
              {selectedPrompts.length > 0 && selectedPrompts.every((p) => p.archived) && (
                <button className="prompts-danger" onClick={deleteSelectedForever}>
                  Delete forever
                </button>
              )}
              <button onClick={endSelecting}>Done</button>
            </>
          ) : (
            <>
              <button onClick={() => setSelecting(true)}>Select</button>
              {counts.negative.length > 0 && (
                <button
                  onClick={() =>
                    bulk(
                      'archive',
                      counts.negative.map((p) => p.id),
                      `Archived ${counts.negative.length} with a negative score — they're under Archived.`,
                    )
                  }
                >
                  Archive all negative ({counts.negative.length})
                </button>
              )}
            </>
          )}
        </div>

        {prompts === null && !loadError && <p className="prompts-empty">Loading…</p>}
        {prompts !== null && visible.length === 0 && <p className="prompts-empty">Nothing here.</p>}

        <ul className="prompts-list">
          {visible.slice(0, shown).map((p) => {
            const myVote = p.votes[me]
            const isEditing = editing?.id === p.id
            return (
              <li
                key={p.id}
                className={`prompt-row${p.archived ? ' archived' : ''}${justAdded.has(p.id) ? ' just-added' : ''}`}
              >
                {selecting && (
                  <input
                    type="checkbox"
                    className="prompt-select"
                    checked={selected.has(p.id)}
                    onChange={() => toggleSelected(p.id)}
                    aria-label={`Select “${p.text}”`}
                  />
                )}
                <div className="prompt-body">
                  {isEditing ? (
                    <form
                      className="prompt-edit"
                      onSubmit={(e) => {
                        e.preventDefault()
                        run(promptApi.edit(p.id, { text: editing.text, mode: editing.mode }), () => setEditing(null))
                      }}
                    >
                      <input
                        value={editing.text}
                        onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                        maxLength={120}
                        autoFocus
                        aria-label="Prompt text"
                      />
                      <select
                        value={editing.mode}
                        onChange={(e) => setEditing({ ...editing, mode: e.target.value as PromptMode })}
                        aria-label="Mode"
                      >
                        {PROMPT_MODES.map((m) => (
                          <option key={m} value={m}>
                            {MODE_LABEL[m]}
                          </option>
                        ))}
                      </select>
                      <button type="submit">Save</button>
                      <button type="button" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    // React escapes this — prompts are shown to other people
                    <p className="prompt-text">{p.text}</p>
                  )}
                  <p className="prompt-meta">
                    {p.author} · <span className="prompt-badge">{MODE_LABEL[p.mode]}</span> · score{' '}
                    {score(p) > 0 ? `+${score(p)}` : score(p)} · built {p.buildCount}×{p.archived ? ' · archived' : ''}
                  </p>
                  {!isEditing && !selecting && (
                    <div className="prompt-actions">
                      <button className="prompt-build" onClick={() => build(p)}>
                        Build
                      </button>
                      <button
                        aria-pressed={myVote === 1}
                        aria-label="Thumbs up"
                        onClick={() => run(promptApi.vote(p.id, 1))}
                      >
                        👍
                      </button>
                      <button
                        aria-pressed={myVote === -1}
                        aria-label="Thumbs down"
                        onClick={() => run(promptApi.vote(p.id, -1))}
                      >
                        👎
                      </button>
                      <button onClick={() => setEditing({ id: p.id, text: p.text, mode: p.mode })}>Edit</button>
                      {p.archived ? (
                        <>
                          <button onClick={() => run(promptApi.edit(p.id, { archived: false }))}>Restore</button>
                          {/* reachable only on an archived prompt, behind a confirm: two
                              deliberate steps to lose anything */}
                          <button
                            className="prompts-danger"
                            onClick={() => {
                              if (window.confirm(`Delete “${p.text}” forever? This can't be undone.`)) {
                                run(promptApi.remove(p.id))
                              }
                            }}
                          >
                            Delete forever
                          </button>
                        </>
                      ) : (
                        <button onClick={() => run(promptApi.edit(p.id, { archived: true }))}>Archive</button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
        {visible.length > shown && (
          <button className="prompts-more" onClick={() => setShown((n) => n + PAGE_SIZE)}>
            Show more ({visible.length - shown} left)
          </button>
        )}
      </div>
    </>
  )
}
