import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { MIN_OPACITY } from './layerItem'
import type { BrushSize } from './erase'
import { layerMoreTools } from './moreTools'

// 24×24 stroke icons — inline so they render the same on every phone,
// unlike symbol glyphs, whose look depends on the system font
const ICONS = {
  add: 'M12 5v14M5 12h14',
  done: 'M5 12l5 5 9-10',
  front: 'M12 19V5M5 12l7-7 7 7',
  back: 'M12 5v14M5 12l7 7 7-7',
  mirror: 'M12 3v18M9 7L3 17h6zM15 7l6 10h-6z',
  // a cut-out inside its rim
  edge: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z',
  crop: 'M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2',
  erase: 'M8 20h12M4.5 15.5l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 19H8z M9 11l5 5',
  delete: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  report: 'M5 21V4h11l-2 4 2 4H5',
  reset: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-4',
  cancel: 'M6 6l12 12M18 6L6 18',
  opacity: 'M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18',
  duplicate: 'M9 9h11v11H9zM5 15H4V4h11v1',
  lock: 'M8 11V7a4 4 0 0 1 8 0v4M5 11h14v10H5z',
  unlock: 'M8 11V7a4 4 0 0 1 7.9-1M5 11h14v10H5z',
  // three dots, each a tiny ring the stroke fills in
  more: 'M4 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M10.5 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M17 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
} as const
type IconName = keyof typeof ICONS

function Icon({ name, bold = false }: { name: IconName; bold?: boolean }) {
  return (
    <svg
      className="toolbar-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={bold ? 3 : 2}
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
  lit,
  expanded,
  hasPopup,
  buttonRef,
  children,
}: {
  icon?: IconName
  label?: string
  onClick: () => void
  // the main action of the row (Add, Apply, Done): riso red on its ledge
  variant?: 'primary'
  disabled?: boolean
  ariaLabel?: string
  pressed?: boolean
  // shown switched on without being a toggle (Unlock: the layer is locked)
  lit?: boolean
  expanded?: boolean
  hasPopup?: 'menu'
  buttonRef?: Ref<HTMLButtonElement>
  // custom glyph instead of an icon (the brush-size dots)
  children?: ReactNode
}) {
  const classes = ['toolbar-btn']
  if (variant) classes.push(`toolbar-btn-${variant}`)
  if (!label) classes.push('toolbar-btn-icon')
  if (pressed || lit) classes.push('toolbar-btn-on')
  return (
    <button
      ref={buttonRef}
      className={classes.join(' ')}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-haspopup={hasPopup}
    >
      {icon && <Icon name={icon} bold={variant === 'primary'} />}
      {children}
      {label && <span className="toolbar-label">{label}</span>}
    </button>
  )
}

export type MoreTool = {
  icon: IconName
  label: string
  onPick: () => void
  disabled?: boolean
  ariaLabel?: string
  // a switch (Mirror): shown on, and said to be checked
  checked?: boolean
}

// The layer tools that don't fit the strip, on a paper card above it — rows
// of icon and typed label. Opens with the first tool focused; the arrows,
// Home and End move between them. Picking one closes the card first, then
// runs the tool.
export function MoreMenu({
  tools,
  onClose,
  menuRef,
}: {
  tools: MoreTool[]
  onClose: (returnFocus: boolean) => void
  menuRef?: Ref<HTMLDivElement>
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const go = (i: number) => {
      e.preventDefault()
      items[(i + items.length) % items.length]?.focus()
    }
    if (e.key === 'ArrowDown') go(at + 1)
    else if (e.key === 'ArrowUp') go(at < 0 ? -1 : at - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(-1)
    else if (e.key === 'Tab') onClose(false)
  }
  return (
    <div ref={menuRef} className="paper-card toolbar-more-menu" role="menu" aria-label="More tools" onKeyDown={onKeyDown}>
      {tools.map((tool) => (
        <button
          key={tool.label}
          className={tool.checked ? 'toolbar-more-item toolbar-btn-on' : 'toolbar-more-item'}
          role={tool.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
          aria-checked={tool.checked}
          aria-label={tool.ariaLabel}
          disabled={tool.disabled}
          onClick={() => {
            onClose(true)
            tool.onPick()
          }}
        >
          <Icon name={tool.icon} />
          <span className="toolbar-label">{tool.label}</span>
        </button>
      ))}
    </div>
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

// The selected layer's controls, in one fixed-height row on a paper strip —
// Add first, then Delete and Lock, then More: a card above the strip with
// the rarer tools (Copy, Mirror, Edge, Crop, Erase, Fade), so the row fits a
// 375px phone without scrolling. Never a second row, which would come out of
// the canvas. Picture actions (undo, submit) live in the top row (PromptBar),
// not here. Crop, erase and opacity take the row over while
// they're in use, each with its own way back.
export default function Toolbar({
  mode,
  selectedId,
  addButtonRef,
  onAdd,
  addLimit,
  mirrored,
  opacity,
  onMirror,
  edged,
  onEdge,
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
  canUndo,
  onUndo,
  hasStrokes,
  onEraseReset,
  onEraseDone,
}: {
  mode: ToolbarMode
  // the selected layer — the opacity slider starts fresh for each
  selectedId: string | null
  addButtonRef: Ref<HTMLButtonElement>
  onAdd: () => void
  // at the layer limit, Add stays where it is, greyed, saying so — and
  // Duplicate greys with it. `perPass`: a chain pass's limit, not the canvas's
  addLimit: { used: number; max: number; perPass: boolean }
  mirrored: boolean
  opacity: number
  onMirror: () => void
  // the selected layer's sticker edge is on; the switch only for a cut-out
  edged: boolean
  onEdge?: () => void
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
  // the picture's undo — while erasing, it takes back the last stroke
  canUndo: boolean
  onUndo: () => void
  // the layer being erased has strokes to reset
  hasStrokes: boolean
  onEraseReset: () => void
  onEraseDone: () => void
}) {
  // the opacity slider is open for one layer: selecting another, or
  // deselecting, closes it without an effect having to
  const [opacityFor, setOpacityFor] = useState<string | null>(null)
  const opacityOpen = mode === 'layer' && selectedId !== null && opacityFor === selectedId
  // at the layer limit nothing more goes on, by Add or by Duplicate
  const full = addLimit.used >= addLimit.max
  const limitLabel = `Layer limit reached: ${addLimit.max}${addLimit.perPass ? ' a pass' : ''}`

  // the More card is open for one layer too, and only in layer mode
  const [moreFor, setMoreFor] = useState<string | null>(null)
  const moreOpen = mode === 'layer' && !opacityOpen && selectedId !== null && moreFor === selectedId
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const closeMore = (returnFocus: boolean) => {
    setMoreFor(null)
    if (returnFocus) moreButtonRef.current?.focus()
  }

  // open: the first tool takes focus; Escape, or a tap anywhere but the
  // card and its button, closes it
  useEffect(() => {
    if (!moreOpen) return
    moreMenuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setMoreFor(null)
      moreButtonRef.current?.focus()
    }
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node
      if (moreMenuRef.current?.contains(target) || moreButtonRef.current?.contains(target)) return
      setMoreFor(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer, true)
    }
  }, [moreOpen])

  const add = (
    <ToolButton
      icon="add"
      label={full ? `${addLimit.used} of ${addLimit.max}` : 'Add'}
      ariaLabel={full ? limitLabel : undefined}
      disabled={full}
      onClick={onAdd}
      variant="primary"
      buttonRef={addButtonRef}
    />
  )

  let buttons: ReactNode
  let menu: ReactNode = null
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
        <ToolButton icon="undo" label="Undo" onClick={onUndo} disabled={!canUndo} ariaLabel="Undo last stroke" />
        <ToolButton icon="reset" label="Reset" onClick={onEraseReset} disabled={!hasStrokes} ariaLabel="Restore the whole layer" />
        <ToolButton icon="done" label="Done" onClick={onEraseDone} variant="primary" ariaLabel="Done erasing" />
      </>
    )
  } else if (opacityOpen) {
    buttons = (
      <>
        <OpacitySlider key={selectedId} value={opacity} onPreview={onOpacityPreview} onCommit={onOpacityCommit} />
        <ToolButton icon="done" label="Done" onClick={() => setOpacityFor(null)} variant="primary" ariaLabel="Done with opacity" />
      </>
    )
  } else if (mode === 'locked') {
    // a locked layer: nothing to do to it but unlock it
    buttons = (
      <>
        {add}
        <ToolButton icon="unlock" label="Unlock" onClick={onToggleLock} ariaLabel="Unlock this layer" lit />
      </>
    )
  } else if (mode === 'layer') {
    // the everyday actions on the strip; the rest behind More, in the same
    // order as before: instant ones first, then the ones that open a mode.
    // Front/Back are on the layer strip's ends, beside the stack they move
    // within
    buttons = (
      <>
        {add}
        <ToolButton icon="delete" label="Delete" onClick={onDelete} />
        <ToolButton icon="lock" label="Lock" onClick={onToggleLock} ariaLabel="Lock this layer — taps pass through it" />
        {onReport && <ToolButton icon="report" label="Report" onClick={onReport} ariaLabel="Report this image" />}
        <ToolButton
          icon="more"
          label="More"
          onClick={() => setMoreFor(moreOpen ? null : selectedId)}
          ariaLabel="More tools"
          expanded={moreOpen}
          hasPopup="menu"
          lit={moreOpen}
          buttonRef={moreButtonRef}
        />
      </>
    )
    if (moreOpen) {
      menu = (
        <MoreMenu
          menuRef={moreMenuRef}
          onClose={closeMore}
          tools={layerMoreTools({
            full,
            limitLabel,
            mirrored,
            edged,
            onDuplicate,
            onMirror,
            onEdge,
            onCrop,
            onErase,
            onFade: () => setOpacityFor(selectedId),
          })}
        />
      )
    }
  } else {
    buttons = add
  }

  return (
    <div className="toolbar-wrap">
      <div className={`toolbar toolbar-${opacityOpen ? 'opacity' : mode}`}>{buttons}</div>
      {menu}
    </div>
  )
}
