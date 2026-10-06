import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react'
import type { Asset, ImageVariant, PixabayHit, SearchResult } from '../assets'
import { LocalAssetSource, SearchError, pixabaySource } from '../assets'
import { mergeResults, promptTabs } from '../assets/search'
import { buildIndex, searchAssets } from '../assetSearch'
import { recordMissingWord } from '../assets/missingWords'
import { CutFailed, canCutOnDevice, cutImage, subscribeCutAvailability, type CutProgress } from '../cutting/cutClient'
import type { Placement } from './layerItem'
import ReportDialog from './ReportDialog'
import { preparePhoto, releaseCanvas } from '../photos/photoCut'
import { savePhoto } from '../photos/photoStore'

// only fetched when someone actually adds a photo
const PhotoLasso = lazy(() => import('../photos/PhotoLasso'))

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}

// single manifest fetch shared for the lifetime of the page
const assetSource = new LocalAssetSource()

// Several players typing at once is what blows the shared Pixabay rate limit —
// a Pixabay search only fires once typing pauses. The library itself is
// searched on every keystroke: it's local, and instant.
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

// A word from the player's prompt, pre-searched (library + Pixabay) — the
// fastest way to what they need on a timer — and, last, All: the library by
// category. With no prompt (freestyle, a blind chain pass) All is the only tab.
type SheetTab = { kind: 'word' | 'all'; label: string; key: string }
const ALL_TAB: SheetTab = { kind: 'all', label: 'All', key: '__all' }

export default function AssetSheet({
  open,
  promptText,
  freestyle,
  allowPhotos = true,
  onClose,
  onPlace,
  onCutShared,
}: {
  open: boolean
  promptText: string
  freestyle: boolean
  // "Your photo" is offered — the room's host can turn it off
  allowPhotos?: boolean
  onClose: () => void
  onPlace: (placement: Placement) => void
  // a cut made on this device finished uploading — the canvas swaps its
  // local blob: URL for the shared one so the layer survives a reload
  onCutShared: (localSrc: string, shared: ImageVariant) => void
}) {
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
  // a photo from this phone, prepared and waiting to be cut — on this device only
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null)
  const [photoState, setPhotoState] = useState<'idle' | 'opening' | 'error'>('idle')

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedInput(input), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [input])

  const tabs = useMemo((): SheetTab[] => {
    const words = freestyle ? [] : promptTabs(promptText).map((t): SheetTab => ({ kind: 'word', label: t.label, key: t.term }))
    return [...words, ALL_TAB]
  }, [freestyle, promptText])
  const activeTab = tabIndex === null ? undefined : tabs[tabIndex]

  // the library's categories, in manifest order — browsed inside All
  const categories = useMemo(() => {
    const seen = new Map<string, string>()
    for (const e of curated ?? []) if (!seen.has(e.asset.category)) seen.set(e.asset.category, e.categoryLabel)
    return [...seen].map(([key, label]) => ({ key, label }))
  }, [curated])
  const [categoryKey, setCategoryKey] = useState<string | null>(null)
  const activeCategory = activeTab?.kind === 'all' ? (categoryKey ?? categories[0]?.key ?? null) : null

  // the library: searched instantly, as typed
  const index = useMemo(() => buildIndex(curated ?? []), [curated])
  const libraryQuery = tabIndex === null ? input.trim().toLowerCase() : activeTab?.kind === 'word' ? activeTab.key : ''
  // Pixabay: only once typing pauses (a tab's word is already settled)
  const manualTerm = input.trim() ? debouncedInput.trim().toLowerCase() : ''
  const activeTerm =
    tabIndex === null
      ? manualTerm.length >= MIN_MANUAL_CHARS
        ? manualTerm
        : null
      : activeTab?.kind === 'word'
        ? activeTab.key
        : null

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

  const libraryMatches = useMemo(() => (libraryQuery ? searchAssets(index, libraryQuery) : []), [index, libraryQuery])

  const results = useMemo(() => {
    if (activeCategory) {
      const assets = (curated ?? []).filter((e) => e.asset.category === activeCategory).map((e) => e.asset)
      return mergeResults(assets, [])
    }
    if (!libraryQuery) return []
    // Pixabay's hits only once they're for what's in the box now — never a
    // stale search under fresh library results
    const hits = activeTerm === libraryQuery ? (termState?.hits ?? []) : []
    return mergeResults(libraryMatches, hits).filter((r) => r.pixabayId === null || r.tier === 1 || !hidden.has(r.pixabayId))
  }, [activeCategory, curated, libraryQuery, libraryMatches, activeTerm, termState, hidden])

  // a prompt word the library has nothing for: shown as an empty tab (the
  // player should know), and counted (so the library can grow where it's thin)
  const loggedMissing = useRef(new Set<string>())
  const missingWord = activeTab?.kind === 'word' && curated !== null && libraryMatches.length === 0 ? activeTab.key : null
  useEffect(() => {
    if (!open || !missingWord || loggedMissing.current.has(missingWord)) return
    loggedMissing.current.add(missingWord)
    recordMissingWord(missingWord)
  }, [open, missingWord])

  // with the keyboard up, the sheet fits what's left of the screen rather
  // than sliding behind the keyboard — so the grid keeps more than one row
  const [keyboard, setKeyboard] = useState<{ inset: number; height: number } | null>(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!open || !vv) return
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      setKeyboard(inset > 80 ? { inset, height: vv.height } : null)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [open])

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

  // The photo is shrunk, turned upright and stripped of its metadata the
  // moment it's picked; the original file is never read again.
  const pickPhoto = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // the same photo can be picked again
    if (!file) return
    setPhotoState('opening')
    preparePhoto(file).then(
      (canvas) => {
        setPhotoState('idle')
        setPhoto(canvas)
      },
      () => setPhotoState('error'),
    )
  }

  const closePhoto = () => {
    releaseCanvas(photo)
    setPhoto(null)
  }

  // the cut, kept on this device and placed like any other layer
  const placePhoto = (cut: Blob) => {
    closePhoto()
    void savePhoto(cut).then((src) => {
      onPlace({ full: src, thumb: src, label: 'Your photo', pixabayId: null })
      onClose()
    })
  }

  const handleReported = (pixabayId: number) => {
    setHidden((prev) => new Set(prev).add(pixabayId))
    setReportTarget(null)
  }

  const showSkeleton =
    (activeTerm !== null && results.length === 0 && (termState?.loading ?? true) && !termState?.error) ||
    // the library is still on its way
    (curated === null && (activeCategory !== null || libraryQuery !== ''))

  return (
    <>
      <div className={`sheet-backdrop${open ? ' open' : ''}`} onClick={onClose} aria-hidden="true" />
      <div
        ref={sheetRef}
        className={`asset-sheet${open ? ' open' : ''}${keyboard ? ' keyboard-open' : ''}`}
        style={keyboard ? { bottom: keyboard.inset, height: keyboard.height } : undefined}
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

        {allowPhotos && (
          <div className="photo-entry">
            <label className={`photo-button${photoState === 'opening' ? ' busy' : ''}`}>
              <CameraIcon />
              {photoState === 'opening' ? 'Opening…' : 'Your photo'}
              <input type="file" accept="image/*" onChange={pickPhoto} disabled={photoState === 'opening'} />
            </label>
            <p className="photo-privacy">
              {photoState === 'error'
                ? 'Couldn’t open that photo — try another.'
                : 'Your photo stays on your phone. Only the finished picture is shared.'}
            </p>
          </div>
        )}

        {tabs.length > 0 && (
          <div
            className="asset-sheet-tabs"
            role="tablist"
            aria-label="Words from your prompt, and the whole library"
          >
            {tabs.map((tab, i) => (
              <button
                key={tab.key}
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

        {/* All: the library by category */}
        {activeTab?.kind === 'all' && categories.length > 0 && (
          <div className="asset-sheet-categories" role="tablist" aria-label="Library categories">
            {categories.map((c) => (
              <button
                key={c.key}
                role="tab"
                aria-selected={c.key === activeCategory}
                className={`asset-sheet-category${c.key === activeCategory ? ' active' : ''}`}
                onClick={() => setCategoryKey(c.key)}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        <div className="asset-sheet-grid">
          {/* a word the library hasn't got: always said plainly, whatever
              Pixabay is doing — before anything it found */}
          {libraryQuery && curated !== null && libraryMatches.length === 0 && (
            <p className="asset-sheet-message library-miss">
              Nothing in the library for “{libraryQuery}”{results.length > 0 ? ' — these are from Pixabay.' : '.'}
            </p>
          )}
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
          {!libraryQuery && activeCategory === null && !showSkeleton ? (
            <p className="asset-sheet-message">Search for anything to add to your picture.</p>
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
                <p className="asset-sheet-message">
                  No pictures of “{activeTerm}” — not in the library, not on Pixabay. Try a nearby word: an animal, a
                  thing, a place.
                </p>
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

      {/* outside the sheet: the sheet slides on a transform, which would
          pin a fixed overlay to it instead of the screen */}
      {photo && (
        <Suspense fallback={null}>
          <PhotoLasso photo={photo} onDone={placePhoto} onCancel={closePhoto} />
        </Suspense>
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
