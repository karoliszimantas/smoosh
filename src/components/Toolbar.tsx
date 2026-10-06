import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { MIN_OPACITY } from './layerItem'
import type { BrushSize } from './erase'

// 24×24 stroke icons — inline so they render the same on every phone,
// unlike symbol glyphs, whose look depends on the system font
const ICONS = {
  add: 'M12 5v14M5 12h14',
  done: 'M5 12l5 5 9-10',
  front: 'M12 19V5M5 12l7-7 7 7',
  back: 'M12 5v14M5 12l7 7 7-7',
  mirror: 'M12 3v18M9 7L3 17h6zM15 7l6 10h-6z',
  crop: 'M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2',
  erase: 'M8 20h12M4.5 15.5l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 19H8z M9 11l5 5',
  delete: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  report: 'M5 21V4h11l-2 4 2 4H5',
  reset: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-4',
  cancel: 'M6 6l12 12M18 6L6 18',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  duplicate: 'M9 9h11v11H9zM5 15H4V4h11v1',
  lock: 'M8 11V7a4 4 0 0 1 8 0v4M5 11h14v10H5z',
  unlock: 'M8 11V7a4 4 0 0 1 7.9-1M5 11h14v10H5z',
} as const
type IconName = keyof typeof ICONS

function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="toolbar-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      // the "more" dots are zero-length lines: their size is the stroke
      strokeWidth={name === 'more' ? 4 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  )
}

function ToolButton({
  icon,
  label,
  onClick,
  variant,
  disabled,
  ariaLabel,
  pressed,
  expanded,
  buttonRef,
  children,
}: {
  icon?: IconName
  label?: string
  onClick: () => void
  variant?: 'primary' | 'danger'
  disabled?: boolean
  ariaLabel?: string
  pressed?: boolean
  expanded?: boolean
  buttonRef?: Ref<HTMLButtonElement>
  // custom glyph instead of an icon (the brush-size dots)
  children?: ReactNode
}) {
  const classes = ['toolbar-btn']
  if (variant) classes.push(`toolbar-btn-${variant}`)
  if (!label) classes.push('toolbar-btn-icon')
  if (pressed) classes.push('toolbar-btn-on')
  return (
    <button
      ref={buttonRef}
      className={classes.join(' ')}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      aria-expanded={expanded}
    >
      {icon && <Icon name={icon} />}
      {children}
      {label && <span className="toolbar-label">{label}</span>}
    </button>
  )
}

// 'locked': a locked layer, selected from the strip — unlocking is all it offers
export type ToolbarMode = 'idle' | 'layer' | 'locked' | 'crop' | 'erase'

// Live while dragging (onPreview touches the Konva node only), committed to
// layer state once on release — the same split as drag and pinch.
function OpacitySlider({
  value,
  onPreview,
  onCommit,
}: {
  value: number
  onPreview: (v: number) => void
  onCommit: (v: number) => void
}) {
  // starts from the layer's value; the parent remounts this per layer
  const [draft, setDraft] = useState(value)
  const dragging = useRef(false)

  const commit = () => {
    dragging.current = false
    onCommit(draft)
  }

  return (
    <label className="opacity-row">
      <span className="opacity-label">Opacity</span>
      <input
        className="opacity-slider"
        type="range"
        min={MIN_OPACITY}
        max={1}
        step={0.05}
        value={draft}
        onPointerDown={() => (dragging.current = true)}
        onChange={(e) => {
          const v = Number(e.target.value)
          setDraft(v)
          onPreview(v)
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={() => dragging.current && commit()}
      />
      <span className="opacity-value">{Math.round(draft * 100)}%</span>
    </label>
  )
}

// Contextual: the controls for what's selected, in one fixed-height row that
// scrolls sideways if a narrow phone can't fit it — never a second row,
// which would come out of the canvas. Less-used layer tools live behind
// More, in a popover that floats above the row and so never resizes it.
// Add stays first and primary whenever it's shown; Done stays last.
export default function Toolbar({
  mode,
  selectedId,
  addButtonRef,
  onAdd,
  addLimit,
  onDone,
  doneLabel = 'Done',
  canMoveFront,
  canMoveBack,
  onFront,
  onBack,
  mirrored,
  opacity,
  onMirror,
  onCrop,
  onErase,
  onDelete,
  onDuplicate,
  onToggleLock,
  onReport,
  onOpacityPreview,
  onOpacityCommit,
  onCropReset,
  onCropCancel,
  onCropApply,
  brush,
  onBrush,
  canUndoErase,
  onEraseUndo,
  onEraseReset,
  onEraseDone,
}: {
  mode: ToolbarMode
  // the selected layer — the More popover's slider starts fresh for each
  selectedId: string | null
  addButtonRef: Ref<HTMLButtonElement>
  onAdd: () => void
  // at the layer limit, Add stays where it is, greyed, saying so — and
  // Duplicate greys with it. `perPass`: a chain pass's limit, not the canvas's
  addLimit: { used: number; max: number; perPass: boolean }
  onDone: () => void
  doneLabel?: string
  canMoveFront: boolean
  canMoveBack: boolean
  onFront: () => void
  onBack: () => void
  mirrored: boolean
  opacity: number
  onMirror: () => void
  onCrop: () => void
  onErase: () => void
  onDelete: () => void
  onDuplicate: () => void
  onToggleLock: () => void
  // only for layers that came from Pixabay — curated assets aren't reportable
  onReport?: () => void
  onOpacityPreview: (v: number) => void
  onOpacityCommit: (v: number) => void
  onCropReset: () => void
  onCropCancel: () => void
  onCropApply: () => void
  brush: BrushSize
  onBrush: (size: BrushSize) => void
  canUndoErase: boolean
  onEraseUndo: () => void
  onEraseReset: () => void
  onEraseDone: () => void
}) {
  // the popover is open for one toolbar state: entering crop or erase, or
  // deselecting, closes it without an effect having to
  const [moreOpenIn, setMoreOpenIn] = useState<ToolbarMode | null>(null)
  const moreOpen = moreOpenIn === mode && mode === 'layer'
  const setMoreOpen = (open: boolean) => setMoreOpenIn(open ? mode : null)
  const wrapRef = useRef<HTMLDivElement>(null)
  // at the layer limit nothing more goes on, by Add or by Duplicate
  const full = addLimit.used >= addLimit.max

  // …and any tap outside it
  useEffect(() => {
    if (!moreOpen) return
    const close = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMoreOpenIn(null)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [moreOpen])

  let buttons: ReactNode
  if (mode === 'crop') {
    buttons = (
      <>
        <ToolButton icon="reset" label="Reset" onClick={onCropReset} ariaLabel="Reset crop to the full image" />
        <ToolButton icon="cancel" label="Cancel" onClick={onCropCancel} />
        <ToolButton icon="done" label="Apply" onClick={onCropApply} variant="primary" />
      </>
    )
  } else if (mode === 'erase') {
    buttons = (
      <>
        {(['S', 'M', 'L'] as const).map((size) => (
          <ToolButton
            key={size}
            label={size}
            onClick={() => onBrush(size)}
            pressed={brush === size}
            ariaLabel={`${{ S: 'Small', M: 'Medium', L: 'Large' }[size]} brush`}
          >
            <span className={`brush-dot brush-dot-${size}`} aria-hidden="true" />
          </ToolButton>
        ))}
        <ToolButton icon="undo" label="Undo" onClick={onEraseUndo} disabled={!canUndoErase} ariaLabel="Undo last stroke" />
        <ToolButton icon="reset" label="Reset" onClick={onEraseReset} disabled={!canUndoErase} ariaLabel="Restore the whole layer" />
        <ToolButton icon="done" label="Done" onClick={onEraseDone} variant="primary" ariaLabel="Done erasing" />
      </>
    )
  } else if (mode === 'locked') {
    // a locked layer: nothing to do to it but unlock it. Add and Done stay —
    // they're the picture's, not the layer's
    buttons = (
      <>
        <ToolButton
          icon="add"
          label={full ? `${addLimit.used} of ${addLimit.max}` : 'Add'}
          ariaLabel={full ? `Layer limit reached: ${addLimit.max}${addLimit.perPass ? ' a pass' : ''}` : undefined}
          disabled={full}
          onClick={onAdd}
          variant="primary"
          buttonRef={addButtonRef}
        />
        <ToolButton icon="unlock" label="Unlock" onClick={onToggleLock} ariaLabel="Unlock this layer" />
        <ToolButton icon="done" label={doneLabel} onClick={onDone} />
      </>
    )
  } else if (mode === 'layer') {
    buttons = (
      <>
        <ToolButton
          icon="add"
          label={full ? `${addLimit.used} of ${addLimit.max}` : 'Add'}
          ariaLabel={full ? `Layer limit reached: ${addLimit.max}${addLimit.perPass ? ' a pass' : ''}` : undefined}
          disabled={full}
          onClick={onAdd}
          variant="primary"
          buttonRef={addButtonRef}
        />
        <ToolButton
          icon="front"
          label="Front"
          onClick={onFront}
          disabled={!canMoveFront}
          ariaLabel="Move layer forward one step"
        />
        <ToolButton
          icon="back"
          label="Back"
          onClick={onBack}
          disabled={!canMoveBack}
          ariaLabel="Move layer backward one step"
        />
        <ToolButton icon="erase" label="Erase" onClick={onErase} />
        <ToolButton icon="delete" label="Delete" onClick={onDelete} variant="danger" />
        <ToolButton
          icon="more"
          label="More"
          onClick={() => setMoreOpen(!moreOpen)}
          pressed={moreOpen}
          expanded={moreOpen}
          ariaLabel="More layer tools"
        />
        <ToolButton icon="done" label={doneLabel} onClick={onDone} />
      </>
    )
  } else {
    buttons = (
      <>
        <ToolButton
          icon="add"
          label={full ? `${addLimit.used} of ${addLimit.max}` : 'Add'}
          ariaLabel={full ? `Layer limit reached: ${addLimit.max}${addLimit.perPass ? ' a pass' : ''}` : undefined}
          disabled={full}
          onClick={onAdd}
          variant="primary"
          buttonRef={addButtonRef}
        />
        <ToolButton icon="done" label={doneLabel} onClick={onDone} />
      </>
    )
  }

  return (
    <div className="toolbar-wrap" ref={wrapRef}>
      {mode === 'layer' && moreOpen && (
        <div className="toolbar-more" role="group" aria-label="More layer tools">
          <div className="toolbar-more-row">
            {/* stays open after a tap: five taps, five copies */}
            <ToolButton
              icon="duplicate"
              label="Duplicate"
              onClick={onDuplicate}
              disabled={full}
              ariaLabel={full ? `Layer limit reached: ${addLimit.max}${addLimit.perPass ? ' a pass' : ''}` : 'Duplicate this layer'}
            />
            <ToolButton
              icon="lock"
              label="Lock"
              onClick={() => {
                setMoreOpen(false)
                onToggleLock()
              }}
              ariaLabel="Lock this layer — taps pass through it"
            />
            <ToolButton icon="mirror" label="Mirror" onClick={onMirror} pressed={mirrored} ariaLabel="Mirror left to right" />
            <ToolButton
              icon="crop"
              label="Crop"
              onClick={() => {
                setMoreOpen(false)
                onCrop()
              }}
            />
            {onReport && <ToolButton icon="report" label="Report" onClick={onReport} ariaLabel="Report this image" />}
          </div>
          <OpacitySlider
            key={selectedId ?? ''}
            value={opacity}
            onPreview={onOpacityPreview}
            onCommit={onOpacityCommit}
          />
        </div>
      )}
      <div className="toolbar">{buttons}</div>
    </div>
  )
}
