import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import type { LabelRow } from '@smoosh/protocol'
import { LocalAssetSource } from '../assets'
import type { Asset } from '../assets/types'
import { getCode, getName, setCode } from '../prompts/access'
import Gate from '../prompts/Gate'
import { missingWords } from '../assets/missingWords'
import { LabelsApiError, labelsApi } from './api'
import { completeTag, isLoneTag, suggestTags, tagVocabulary } from './suggest'

// /labels — labelling the asset library from a phone. The work is the
// grid: tap an asset, give it a label and tags, Save & next takes you to the
// next one, so a batch is a rhythm rather than a run of decisions.
//
// Edits land in the live labels file (server/src/labels), which the laptop
// pulls into tools/asset-labels.tsv. Nothing is deleted from here: "remove"
// takes an asset out of the library and can be undone.

type Filter = 'needs' | 'tags' | 'removed' | 'all' | 'gaps'

// an asset in the published library, its row if it has one — or a row
// whose asset isn't published (removed ones), with no picture to show
type Item = { id: string; category: string; asset: Asset | null; row: LabelRow | null }

const FILTER_LABEL: Record<Filter, string> = {
  needs: 'Needs a label',
  tags: 'Needs tags',
  removed: 'Removed',
  all: 'All',
  gaps: 'Gaps',
}

function matches(item: Item, f: Filter): boolean {
  if (f === 'needs') return item.asset !== null && item.row === null
  if (f === 'tags') return item.row !== null && !item.row.remove && item.row.label !== '' && item.row.tags.length === 0
  if (f === 'removed') return item.row?.remove === true
  return f === 'all'
}

const source = new LocalAssetSource()

async function loadLibrary(): Promise<{ assets: Asset[]; categories: { id: string; label: string }[] }> {
  const categories = await source.listCategories()
  const lists = await Promise.all(categories.map((c) => source.browse(c.id)))
  return { assets: lists.flat(), categories: categories.map((c) => ({ id: c.id, label: c.label })) }
}

export default function LabelsView() {
  const [ready, setReady] = useState(() => getCode() !== '' && getName() !== '')
  const [gateError, setGateError] = useState<string | null>(null)
  const [rows, setRows] = useState<LabelRow[] | null>(null)
  const [library, setLibrary] = useState<{ assets: Asset[]; categories: { id: string; label: string }[] } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('needs')
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const fail = useCallback((err: unknown) => {
    if (err instanceof LabelsApiError && err.code === 'wrong_code') {
      setCode('')
      setGateError(err.message)
      setReady(false)
      return
    }
    setLoadError(err instanceof Error ? err.message : 'Something went wrong.')
  }, [])

  const refresh = useCallback(() => {
    labelsApi.list().then((d) => {
      setRows(d.rows)
      setLoadError(null)
    }, fail)
  }, [fail])

  useEffect(() => {
    if (!ready) return
    refresh()
    loadLibrary().then(setLibrary, () => setLoadError('The asset library didn’t load.'))
  }, [ready, refresh])

  // coming back to the tab picks up the others' edits
  useEffect(() => {
    if (!ready) return
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [ready, refresh])

  const items = useMemo((): Item[] => {
    if (!rows || !library) return []
    const byId = new Map(rows.map((r) => [r.id, r]))
    const seen = new Set<string>()
    const out: Item[] = library.assets.map((asset) => {
      seen.add(asset.id)
      return { id: asset.id, category: asset.category, asset, row: byId.get(asset.id) ?? null }
    })
    for (const r of rows) if (!seen.has(r.id)) out.push({ id: r.id, category: r.category, asset: null, row: r })
    return out
  }, [rows, library])

  const inCategory = useMemo(() => items.filter((i) => category === 'all' || i.category === category), [items, category])
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { needs: 0, tags: 0, removed: 0, all: 0, gaps: missingWords().length }
    for (const i of inCategory) for (const f of ['needs', 'tags', 'removed', 'all'] as const) if (matches(i, f)) c[f]++
    return c
  }, [inCategory])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return inCategory.filter(
      (i) =>
        matches(i, filter) &&
        (!q ||
          (i.row?.label ?? i.asset?.label ?? '').toLowerCase().includes(q) ||
          (i.row?.tags ?? []).some((t) => t.includes(q)) ||
          i.id.includes(q)),
    )
  }, [inCategory, filter, search])

  const vocabulary = useMemo(() => tagVocabulary(rows ?? []), [rows])

  if (!ready) {
    return (
      <div className="prompts-view">
        <Gate
          title="Labels"
          error={gateError}
          onDone={() => {
            setGateError(null)
            setReady(true)
          }}
        />
      </div>
    )
  }

  const current = editing ? items.find((i) => i.id === editing) : undefined

  return (
    <div className="prompts-view labels-view">
      <h1 className="labels-title">Labels</h1>
      <div className="labels-filters" role="tablist" aria-label="Show">
        {(['needs', 'tags', 'removed', 'all', 'gaps'] as const).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
            {FILTER_LABEL[f]} <span className="labels-count">{counts[f]}</span>
          </button>
        ))}
      </div>
      <p className="labels-summary">
        {counts.needs} need labels · {counts.tags} need tags · {counts.removed} removed
      </p>
      {filter !== 'gaps' && (
        <div className="labels-tools">
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="all">Every category</option>
            {library?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          {filter === 'all' && (
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search labels and tags" aria-label="Search" />
          )}
        </div>
      )}
      {notice && (
        <p className="prompts-notice" onClick={() => setNotice(null)}>
          {notice}
        </p>
      )}
      {loadError && <p className="prompts-error">{loadError}</p>}
      {(!rows || !library) && !loadError && <p className="prompts-empty">Loading…</p>}

      {filter === 'gaps' ? (
        <Gaps />
      ) : (
        rows &&
        library &&
        (shown.length === 0 ? (
          <p className="prompts-empty">
            {filter === 'needs' ? 'Every asset has a label. New ones appear here after the next cut and publish.' : 'Nothing here.'}
          </p>
        ) : (
          <ul className="labels-grid">
            {shown.map((i) => (
              <li key={i.id}>
                <button className={`labels-tile${i.row?.remove ? ' removed' : ''}`} onClick={() => setEditing(i.id)}>
                  <span className="labels-thumb">
                    {i.asset ? <img src={i.asset.thumb} alt="" loading="lazy" /> : <span className="labels-nothumb">not in the library</span>}
                  </span>
                  <span className="labels-tile-label">{i.row?.label || i.asset?.label || i.id}</span>
                  <span className="labels-tile-meta">
                    {i.row ? `${i.row.tags.length} tag${i.row.tags.length === 1 ? '' : 's'}` : 'no label yet'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ))
      )}

      {current && rows && (
        <Editor
          key={current.id}
          item={current}
          rows={rows}
          vocabulary={vocabulary}
          onClose={() => setEditing(null)}
          onSkip={setEditing}
          onSaved={(row, nextId) => {
            setRows((prev) => {
              const list = prev ?? []
              return list.some((r) => r.id === row.id) ? list.map((r) => (r.id === row.id ? row : r)) : [...list, row]
            })
            setEditing(nextId)
            if (!nextId) setNotice('Saved — that was the last one here.')
          }}
          onAuthFail={fail}
          onStale={refresh}
          nextId={(() => {
            const at = shown.findIndex((i) => i.id === current.id)
            return shown[at + 1]?.id ?? null
          })()}
        />
      )}
    </div>
  )
}

// One asset, being labelled.
function Editor({
  item,
  rows,
  vocabulary,
  nextId,
  onClose,
  onSkip,
  onSaved,
  onAuthFail,
  onStale,
}: {
  item: Item
  rows: readonly LabelRow[]
  vocabulary: ReadonlyMap<string, number>
  nextId: string | null
  onClose: () => void
  // on to the next without saving anything
  onSkip: (nextId: string) => void
  onSaved: (row: LabelRow, nextId: string | null) => void
  onAuthFail: (err: unknown) => void
  onStale: () => void
}) {
  const row = item.row
  // a new asset starts from its filename's label — a starting point to fix
  const [label, setLabel] = useState(row?.label ?? item.asset?.label ?? '')
  const [tags, setTags] = useState<string[]>(row?.tags ?? [])
  const [typed, setTyped] = useState('')
  const [remove, setRemove] = useState(row?.remove ?? false)
  const [note, setNote] = useState(row?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const suggestions = useMemo(() => suggestTags(label, rows, item.id, tags), [label, rows, item.id, tags])
  const completions = completeTag(typed, vocabulary, tags)
  const onThisAsset = new Set(row?.tags ?? [])

  const addTag = (t: string) => {
    const tag = t.trim().toLowerCase().replace(/,/g, '')
    if (tag && !tags.includes(tag)) setTags([...tags, tag])
    setTyped('')
  }
  const onTagKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(typed)
    } else if (e.key === 'Backspace' && typed === '' && tags.length > 0) setTags(tags.slice(0, -1))
  }

  const save = (goNext: boolean) => {
    if (busy) return
    const pending = typed.trim() ? [...tags, typed.trim().toLowerCase()] : tags
    setBusy(true)
    setError(null)
    labelsApi
      .save(item.id, { category: item.category, label, tags: pending, remove, note, seen: row?.editedAt ?? '' })
      .then(
        ({ row: saved }) => onSaved(saved, goNext ? nextId : null),
        (err: unknown) => {
          if (err instanceof LabelsApiError && err.code === 'wrong_code') return onAuthFail(err)
          setError(err instanceof Error ? err.message : 'That didn’t save.')
          if (err instanceof LabelsApiError && err.code === 'changed') onStale()
        },
      )
      .finally(() => setBusy(false))
  }

  return (
    <div className="labels-editor" role="dialog" aria-modal="true" aria-label={`Label ${item.id}`}>
      <div className="labels-editor-bar">
        <button onClick={onClose}>Close</button>
        <span className="labels-editor-id">{item.id}</span>
        {nextId && (
          <button onClick={() => onSkip(nextId)}>Skip</button>
        )}
      </div>
      <div className="labels-editor-picture">
        {item.asset ? <img src={item.asset.full} alt="" /> : <p className="prompts-empty">Not in the published library — restore it to bring it back.</p>}
      </div>
      <label className="labels-field">
        Label
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="What is it?" autoCapitalize="words" />
      </label>

      <div className="labels-field">
        Tags <small>other words someone might search for it by</small>
        <div className="labels-tags">
          {tags.map((t) => (
            <button key={t} className={`labels-tag${isLoneTag(t, vocabulary, onThisAsset.has(t)) ? ' lone' : ''}`} onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={`Remove tag ${t}`}>
              {t}
              {isLoneTag(t, vocabulary, onThisAsset.has(t)) && <span className="labels-lone"> only here</span>} ×
            </button>
          ))}
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={onTagKey}
            placeholder={tags.length === 0 ? 'Type a tag, Enter to add' : 'Add another'}
            aria-label="Add a tag"
            autoCapitalize="off"
          />
        </div>
        {completions.length > 0 && (
          <div className="labels-chips" aria-label="Tags already in use">
            {completions.map((t) => (
              <button key={t} onClick={() => addTag(t)}>
                {t} <small>{vocabulary.get(t)}</small>
              </button>
            ))}
          </div>
        )}
        {suggestions.length > 0 && (
          <>
            <small className="labels-hint">Similar assets use — tap to add:</small>
            <div className="labels-chips suggest">
              {suggestions.map((t) => (
                <button key={t} onClick={() => addTag(t)}>
                  + {t}
                </button>
              ))}
            </div>
          </>
        )}
        {tags.some((t) => isLoneTag(t, vocabulary, onThisAsset.has(t))) && (
          <small className="labels-hint">“only here”: no other asset has this tag — a typo, or a synonym of one that exists?</small>
        )}
      </div>

      <label className="prompts-check">
        <input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} />
        Remove from the library (a broken or unusable cut — can be undone)
      </label>
      <label className="labels-field">
        Note
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Anything worth knowing" />
      </label>
      {row?.editedBy && (
        <p className="labels-hint">
          Last edited by {row.editedBy}
          {row.editedAt ? `, ${new Date(row.editedAt).toLocaleString()}` : ''}
        </p>
      )}
      {error && <p className="prompts-error">{error}</p>}
      <div className="labels-editor-actions">
        <button className="prompts-primary" onClick={() => save(true)} disabled={busy}>
          {busy ? 'Saving…' : nextId ? 'Save & next' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// The library's gaps: prompt words the picker found nothing for.
function Gaps() {
  const words = missingWords()
  return (
    <div className="labels-gaps">
      <p className="labels-hint">
        Prompt words players searched and the library had nothing for — the shopping list for what to fetch next.
        These are the counts from <strong>this device only</strong>: each phone keeps its own, and they aren’t sent
        anywhere yet.
      </p>
      {words.length === 0 ? (
        <p className="prompts-empty">None on this device yet.</p>
      ) : (
        <ol className="labels-gaps-list">
          {words.map(([w, n]) => (
            <li key={w}>
              <span>{w}</span>
              <span className="labels-count">{n}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

