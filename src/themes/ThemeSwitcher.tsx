import { useEffect, useRef, useState } from 'react'
import { THEMES } from './index'
import { useThemeControl } from './useTheme'

// Numbered swatches, each painted in its own theme's canvas and primary
// colour — a visual choice, not a list of names. Switching is a context
// update: no reload, nothing remounts, no canvas state is touched.
function Swatches({ onPicked }: { onPicked?: () => void }) {
  const { theme, setThemeId } = useThemeControl()
  return (
    <div className="theme-swatches" role="radiogroup" aria-label="Style">
      {THEMES.map((t, i) => (
        <button
          key={t.id}
          role="radio"
          aria-checked={t.id === theme.id}
          aria-label={t.name}
          title={t.name}
          className={`theme-swatch${t.id === theme.id ? ' active' : ''}`}
          // a swatch shows its own theme, not the active one
          style={{ background: t.canvasBg, borderColor: t.chromeBorder }}
          onClick={() => {
            setThemeId(t.id)
            onPicked?.()
          }}
        >
          <span className="theme-swatch-number" style={{ background: t.primaryBg, color: t.primaryText }}>
            {i + 1}
          </span>
        </button>
      ))}
    </div>
  )
}

// inline: the swatch row itself (lobby). compact: one swatch-sized button
// that opens the row (inside a round, where there's no room to keep it out)
export default function ThemeSwitcher({ variant }: { variant: 'inline' | 'compact' }) {
  const { theme } = useThemeControl()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  if (variant === 'inline') return <Swatches />

  const index = THEMES.findIndex((t) => t.id === theme.id)
  return (
    <div className="theme-switcher-compact" ref={rootRef}>
      <button
        className="theme-swatch active"
        aria-label={`Style: ${theme.name}`}
        aria-expanded={open}
        style={{ background: theme.canvasBg, borderColor: theme.chromeBorder }}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="theme-swatch-number" style={{ background: theme.primaryBg, color: theme.primaryText }}>
          {index + 1}
        </span>
      </button>
      {open && (
        <div className="theme-popover">
          <Swatches onPicked={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}
