import { useEffect, useRef, useState } from 'react'
import type { Asset, Category } from '../assets'
import { LocalAssetSource } from '../assets'

// single manifest fetch shared for the lifetime of the page
const assetSource = new LocalAssetSource()

export default function AssetSheet({
  open,
  onClose,
  onSelect,
}: {
  open: boolean
  onClose: () => void
  onSelect: (asset: Asset) => void
}) {
  const [categories, setCategories] = useState<Category[] | null>(null)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [assetsByCategory, setAssetsByCategory] = useState<Record<string, Asset[]>>({})
  const [categoriesError, setCategoriesError] = useState<string | null>(null)
  const [retryToken, setRetryToken] = useState(0)
  const loadedCategories = useRef(new Set<string>())
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    assetSource
      .listCategories()
      .then((cats) => {
        if (cancelled) return
        setCategoriesError(null)
        setCategories(cats)
        setActiveCategory((prev) => prev ?? cats[0]?.id ?? null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error('failed to load categories', err)
        setCategoriesError('Could not load the asset library.')
      })
    return () => {
      cancelled = true
    }
  }, [retryToken])

  useEffect(() => {
    if (!activeCategory || loadedCategories.current.has(activeCategory)) return
    let cancelled = false
    assetSource
      .browse(activeCategory)
      .then((result) => {
        if (cancelled) return
        loadedCategories.current.add(activeCategory)
        setAssetsByCategory((prev) => ({ ...prev, [activeCategory]: result }))
      })
      .catch((err: unknown) => console.error('failed to load assets', err))
    return () => {
      cancelled = true
    }
  }, [activeCategory])

  useEffect(() => {
    if (open) sheetRef.current?.focus()
  }, [open])

  const assets = activeCategory ? (assetsByCategory[activeCategory] ?? null) : null

  const handleSelect = (asset: Asset) => {
    onSelect(asset)
    onClose() // one-line to remove if adding should leave the sheet open
  }

  return (
    <>
      <div
        className={`sheet-backdrop${open ? ' open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
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

        {categoriesError ? (
          <div className="sheet-error">
            <span>{categoriesError}</span>
            <button onClick={() => setRetryToken((t) => t + 1)}>Retry</button>
          </div>
        ) : (
          <>
            <div className="asset-sheet-tabs" role="tablist">
              {categories === null
                ? Array.from({ length: 4 }, (_, i) => (
                    <div key={i} className="asset-sheet-tab skeleton" aria-hidden="true" />
                  ))
                : categories.map((cat) => (
                    <button
                      key={cat.id}
                      role="tab"
                      aria-selected={cat.id === activeCategory}
                      className={`asset-sheet-tab${cat.id === activeCategory ? ' active' : ''}`}
                      onClick={() => setActiveCategory(cat.id)}
                    >
                      {cat.label}
                    </button>
                  ))}
            </div>

            <div className="asset-sheet-grid">
              {assets === null
                ? Array.from({ length: 8 }, (_, i) => (
                    <div key={i} className="asset-sheet-item skeleton" aria-hidden="true" />
                  ))
                : assets.map((asset) => (
                    <button
                      key={asset.id}
                      className="asset-sheet-item"
                      onClick={() => handleSelect(asset)}
                    >
                      <img src={asset.thumb} alt={asset.label} loading="lazy" />
                    </button>
                  ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}
