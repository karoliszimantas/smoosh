import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Asset, ImageVariant, PixabayHit, SearchResult } from '../assets'
import { LocalAssetSource, SearchError, pixabaySource } from '../assets'
import { matchesCurated, mergeResults, promptTabs } from '../assets/search'
import { CutFailed, canCutOnDevice, cutImage, subscribeCutAvailability, type CutProgress } from '../cutting/cutClient'
import type { Placement } from './layerItem'
import ReportDialog from './ReportDialog'

// single manifest fetch shared for the lifetime of the page
const assetSource = new LocalAssetSource()

// Four players typing at once is what blows the shared Pixabay rate limit —
// manual search only fires once typing pauses.
const SEARCH_DEBOUNCE_MS = 500
const MIN_MANUAL_CHARS = 2

type CuratedEntry = { asset: Asset; categoryLabel: string }

let curatedPromise: Promise<CuratedEntry[]> | null = null

function loadCurated(): Promise<CuratedEntry[]> {
  if (!curatedPromise) {
    curatedPromise = assetSource
      .listCategories()
      .then((cats) =>
        Promise.all(
          cats.map(async (cat) => (await assetSource.browse(cat.id)).map((asset) => ({ asset, categoryLabel: cat.label }))),
        ),
      )
      .then((groups) => groups.flat())
      .catch((err: unknown) => {
        curatedPromise = null
        throw err
      })
  }
  return curatedPromise
}

type TermState = {
  hits: PixabayHit[]
  nextPage: number | null
  loading: boolean
  error: string | null
}

type CardStatus = { kind: 'download'; pct: number } | { kind: 'cutting' } | { kind: 'error'; message: string }

const PER_PAGE = 20

export default function AssetSheet({
  open,
  promptText,
  onClose,
  onPlace,
  onCutShared,
}: {
  open: boolean
  promptText: string
  onClose: () => void
  onPlace: (placement: Placement) => void
  // a cut made on this device finished uploading — the canvas swaps its
  // local blob: URL for the shared one so the layer survives a reload
  onCutShared: (localSrc: string, shared: ImageVariant) => void
}) {
  const tabs = useMemo(() => promptTabs(promptText), [promptText])
  const [tabIndex, setTabIndex] = useState<number | null>(0)
  const lastTabIndex = useRef(0)
  const [input, setInput] = useState('')
  const [debouncedInput, setDebouncedInput] = useState('')
  const [terms, setTerms] = useState<Record<string, TermState>>({})
  const [curated, setCurated] = useState<CuratedEntry[] | null>(null)
  const [cardStatus, setCardStatus] = useState<Record<string, CardStatus>>({})
  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set())
  const [reportTarget, setReportTarget] = useState<number | null>(null)
  const cutAvailable = useSyncExternalStore(subscribeCutAvailability, canCutOnDevice)
  const sheetRef = useRef<HTMLDivElement>(null)
  const refreshedTerms = useRef(new Set<string>())

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedInput(input), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [input])

  const manualTerm = input.trim() ? debouncedInput.trim().toLowerCase() : ''
  const activeTerm =
    tabIndex === null
      ? manualTerm.length >= MIN_MANUAL_CHARS
        ? manualTerm
        : null
      : (tabs[tabIndex]?.term ?? null)

  useEffect(() => {
    if (!open || curated) return
    let cancelled = false
    loadCurated().then(
      (entries) => {
        if (!cancelled) setCurated(entries)
      },
      (err: unknown) => {
        // curated is the fast path, not the only one — search still works
        console.error('failed to load curated assets', err)
        if (!cancelled) setCurated([])
      },
    )
    return () => {
      cancelled = true
    }
  }, [open, curated])

  const inFlight = useRef(new Set<string>())

  // Starts a request and records its outcome. Deliberately sets no state
  // up front, so the open-on-a-tab effect below can call it — a term with no
  // entry in `terms` yet already renders as loading.
  const requestPage = useCallback((term: string, page: number) => {
    const key = `${page}:${term}`
    if (inFlight.current.has(key)) return
    inFlight.current.add(key)
    pixabaySource
      .search(term, page)
      .then(
        (result) =>
          setTerms((prev) => {
            const before = prev[term]?.hits ?? []
            const hits = page === 1 ? result.hits : [...before, ...result.hits]
            const hasMore = page * PER_PAGE < result.totalHits && result.hits.length > 0
            return { ...prev, [term]: { hits, nextPage: hasMore ? page + 1 : null, loading: false, error: null } }
          }),
        (err: unknown) => {
          const message = err instanceof SearchError ? err.message : 'Search failed. Try again.'
          setTerms((prev) => ({
            ...prev,
            [term]: { ...(prev[term] ?? { hits: [], nextPage: page }), loading: false, error: message },
          }))
        },
      )
      .finally(() => inFlight.current.delete(key))
  }, [])

  // "More" and "Retry" — user actions, so they can flag loading immediately
  const fetchPage = (term: string, page: number) => {
    setTerms((prev) => ({
      ...prev,
      [term]: { ...(prev[term] ?? { hits: [], nextPage: page }), loading: true, error: null },
    }))
    requestPage(term, page)
  }

  // A tab's search runs as soon as the sheet is open on it. Coming back to a
  // term we already have re-checks only which results got cut since (another
  // player may have cut one) — one cheap lookup, no Pixabay call.
  useEffect(() => {
    if (!open || !activeTerm) return
    const existing = terms[activeTerm]
    if (!existing) {
      requestPage(activeTerm, 1)
      return
    }
    if (refreshedTerms.current.has(activeTerm)) return
    refreshedTerms.current.add(activeTerm)
    const uncut = existing.hits.filter((h) => !h.cut).map((h) => h.id)
    pixabaySource
      .lookupCuts(uncut.slice(0, 100))
      .then((found) => {
        if (found.size === 0) return
        setTerms((prev) => applyCuts(prev, found))
      })
      .catch((err: unknown) => console.error('cut lookup failed', err))
    // terms is read, not reacted to — re-running on every results change
    // would refetch in a loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeTerm, requestPage])

  // every time the sheet opens, let returning to a term refresh its cuts again
  useEffect(() => {
    if (!open) refreshedTerms.current.clear()
  }, [open])

  useEffect(() => {
    if (open) sheetRef.current?.focus()
  }, [open])

  const termState = activeTerm ? terms[activeTerm] : undefined

  const results = useMemo(() => {
    if (!activeTerm) return []
    const curatedMatches = (curated ?? [])
      .filter((e) => matchesCurated(e.asset, e.categoryLabel, activeTerm))
      .map((e) => e.asset)
    return mergeResults(curatedMatches, termState?.hits ?? []).filter(
      (r) => r.pixabayId === null || r.tier === 1 || !hidden.has(r.pixabayId),
    )
  }, [activeTerm, curated, termState, hidden])

  const selectTab = (index: number) => {
    lastTabIndex.current = index
    setTabIndex(index)
    setInput('')
    setDebouncedInput('')
  }

  const handleInput = (value: string) => {
    setInput(value)
    if (value.trim()) setTabIndex(null)
    else setTabIndex(lastTabIndex.current)
  }

  const setStatus = (key: string, status: CardStatus | null) =>
    setCardStatus((prev) => {
      const next = { ...prev }
      if (status) next[key] = status
      else delete next[key]
      return next
    })

  const place = (result: SearchResult, image: ImageVariant) => {
    // curated assets carry a Pixabay id only for deduping — they aren't
    // reportable (the blocklist can't touch the manifest), so the layer
    // mustn't offer a report control either
    onPlace({ ...image, label: result.label, pixabayId: result.tier === 1 ? null : result.pixabayId })
    onClose() // one-line to remove if adding should leave the sheet open
  }

  const cutOnDevice = (result: SearchResult) => {
    const { pixabayId, rect, key } = result
    if (pixabayId === null || !rect) return
    setStatus(key, { kind: 'download', pct: 0 })

    const onProgress = (p: CutProgress) =>
      setStatus(
        key,
        p.stage === 'cutting'
          ? { kind: 'cutting' }
          : { kind: 'download', pct: p.total > 0 ? Math.floor((p.loaded / p.total) * 100) : 0 },
      )

    cutImage(rect.full, onProgress).then(
      (output) => {
        setStatus(key, null)
        const localUrl = URL.createObjectURL(output.place)
        place(result, { full: localUrl, thumb: localUrl })

        // the player never waits on this — the cut is already on their canvas
        if (!output.upload) return
        pixabaySource.uploadCut(pixabayId, output.upload).then(
          (shared) => {
            onCutShared(localUrl, shared)
            setTerms((prev) => applyCuts(prev, new Map([[pixabayId, shared]])))
          },
          (err: unknown) => console.warn('cut upload failed (kept locally)', err),
        )
      },
      (err: unknown) => {
        const message = err instanceof CutFailed ? err.message : 'Cutting failed — use Full instead.'
        setStatus(key, { kind: 'error', message })
        window.setTimeout(() => setStatus(key, null), 4000)
      },
    )
  }

  const handleCut = (result: SearchResult) => {
    if (result.cut) place(result, result.cut)
    else cutOnDevice(result)
  }

  const handleReported = (pixabayId: number) => {
    setHidden((prev) => new Set(prev).add(pixabayId))
    setReportTarget(null)
  }

  const showSkeleton = activeTerm !== null && results.length === 0 && (termState?.loading ?? true) && !termState?.error

  return (
    <>
      <div className={`sheet-backdrop${open ? ' open' : ''}`} onClick={onClose} aria-hidden="true" />
      <div
        ref={sheetRef}
        className={`asset-sheet${open ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Add to canvas"
        aria-hidden={!open}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
      >
        <div className="sheet-handle" />

        <div className="asset-sheet-search">
          <input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            placeholder="Search anything…"
            aria-label="Search images"
            value={input}
            maxLength={100}
            onChange={(e) => handleInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter skips the debounce — the player has clearly finished
              if (e.key === 'Enter') setDebouncedInput(input)
            }}
          />
        </div>

        {tabs.length > 0 && (
          <div className="asset-sheet-tabs" role="tablist" aria-label="Words from your prompt">
            {tabs.map((tab, i) => (
              <button
                key={tab.term}
                role="tab"
                aria-selected={i === tabIndex}
                className={`asset-sheet-tab${i === tabIndex ? ' active' : ''}`}
                onClick={() => selectTab(i)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <div className="asset-sheet-grid">
          {/* Pixabay's one condition for free API use: wherever its search
              results are shown, say where they come from */}
          {termState && termState.hits.length > 0 && (
            <p className="asset-sheet-credit">
              Images from{' '}
              <a href="https://pixabay.com/" target="_blank" rel="noopener noreferrer">
                Pixabay
              </a>
            </p>
          )}
          {activeTerm === null ? (
            <p className="asset-sheet-message">
              {tabIndex === null ? 'Keep typing…' : 'Search for anything to add to your picture.'}
            </p>
          ) : showSkeleton ? (
            Array.from({ length: 6 }, (_, i) => <div key={i} className="result-card skeleton" aria-hidden="true" />)
          ) : (
            results.map((result) => (
              <ResultCard
                key={result.key}
                result={result}
                status={cardStatus[result.key] ?? null}
                cutAvailable={cutAvailable}
                onCut={handleCut}
                onFull={(r) => r.rect && place(r, r.rect)}
                onReport={setReportTarget}
              />
            ))
          )}

          {activeTerm !== null && termState && !termState.loading && (
            <div className="asset-sheet-footer">
              {termState.error ? (
                <div className="sheet-error">
                  <span>{termState.error}</span>
                  <button onClick={() => fetchPage(activeTerm, termState.nextPage ?? 1)}>Retry</button>
                </div>
              ) : results.length === 0 ? (
                <p className="asset-sheet-message">No pictures of “{activeTerm}”. Try another word.</p>
              ) : termState.nextPage !== null ? (
                <button className="asset-sheet-more" onClick={() => fetchPage(activeTerm, termState.nextPage ?? 1)}>
                  More
                </button>
              ) : null}
            </div>
          )}
          {termState?.loading && results.length > 0 && <p className="asset-sheet-message">Loading…</p>}
        </div>
      </div>

      {reportTarget !== null && (
        <ReportDialog pixabayId={reportTarget} onReported={handleReported} onClose={() => setReportTarget(null)} />
      )}
    </>
  )
}

function applyCuts(terms: Record<string, TermState>, found: ReadonlyMap<number, ImageVariant>): Record<string, TermState> {
  const next: Record<string, TermState> = {}
  for (const [term, state] of Object.entries(terms)) {
    next[term] = { ...state, hits: state.hits.map((h) => (found.has(h.id) ? { ...h, cut: found.get(h.id) ?? h.cut } : h)) }
  }
  return next
}

function ResultCard({
  result,
  status,
  cutAvailable,
  onCut,
  onFull,
  onReport,
}: {
  result: SearchResult
  status: CardStatus | null
  cutAvailable: boolean
  onCut: (result: SearchResult) => void
  onFull: (result: SearchResult) => void
  onReport: (pixabayId: number) => void
}) {
  const isCut = result.cut !== null
  // an uncut image needs this device to cut it — hidden entirely when it can't
  const showCut = isCut || (result.tier === 3 && cutAvailable)
  const showFull = result.rect !== null
  // backgrounds default to Full: never nudge anyone into cutting a landscape
  const primary = !showCut || result.isBackground ? 'full' : 'cut'
  const busy = status?.kind === 'download' || status?.kind === 'cutting'

  return (
    <div className={`result-card${isCut ? ' is-cut' : ''}`}>
      <div className="result-thumb">
        <img src={result.thumb} alt={result.label} loading="lazy" />
        {status && (
          <div className={`result-status${status.kind === 'error' ? ' error' : ''}`} role="status">
            {status.kind === 'download' && (
              <>
                <span>Getting cutter… {status.pct}%</span>
                <span className="result-progress">
                  <span style={{ width: `${status.pct}%` }} />
                </span>
              </>
            )}
            {status.kind === 'cutting' && <span>Cutting…</span>}
            {status.kind === 'error' && <span>{status.message}</span>}
          </div>
        )}
      </div>

      {result.tier !== 1 && result.pixabayId !== null && (
        <button
          className="result-report"
          aria-label={`Report ${result.label}`}
          onClick={() => result.pixabayId !== null && onReport(result.pixabayId)}
        >
          ⚑
        </button>
      )}

      <div className="result-actions">
        {showCut && (
          <button
            className={`result-action${primary === 'cut' ? ' primary' : ''}`}
            disabled={busy}
            onClick={() => onCut(result)}
            aria-label={`Cut ${result.label}`}
          >
            Cut
          </button>
        )}
        {showFull && (
          <button
            className={`result-action${primary === 'full' ? ' primary' : ''}`}
            disabled={busy}
            onClick={() => onFull(result)}
            aria-label={`Full ${result.label}`}
          >
            Full
          </button>
        )}
      </div>
    </div>
  )
}
