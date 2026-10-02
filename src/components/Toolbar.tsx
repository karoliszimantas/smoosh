import type { ReactNode, Ref } from 'react'

// 24×24 stroke icons — inline so they render the same on every phone,
// unlike symbol glyphs, whose look depends on the system font
const ICONS = {
  add: 'M12 5v14M5 12h14',
  done: 'M5 12l5 5 9-10',
  close: 'M15 18l-6-6 6-6',
  front: 'M12 19V5M5 12l7-7 7 7',
  back: 'M12 5v14M5 12l7 7 7-7',
  mirror: 'M12 3v18M9 7L3 17h6zM15 7l6 10h-6z',
  flip: 'M3 12h18M7 9l10-6v6zM7 15l10 6v-6z',
  crop: 'M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2',
  delete: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  report: 'M5 21V4h11l-2 4 2 4H5',
  reset: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  cancel: 'M6 6l12 12M18 6L6 18',
} as const

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      className="toolbar-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
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
  buttonRef,
}: {
  icon: keyof typeof ICONS
  label?: string
  onClick: () => void
  variant?: 'primary' | 'danger'
  disabled?: boolean
  ariaLabel?: string
  pressed?: boolean
  buttonRef?: Ref<HTMLButtonElement>
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
    >
      <Icon name={icon} />
      {label && <span className="toolbar-label">{label}</span>}
    </button>
  )
}

export type ToolbarMode = 'idle' | 'layer' | 'crop'

// Contextual: only the controls for what's selected, in one row that
// scrolls sideways if a narrow phone can't fit it — never a second row,
// which would come out of the canvas
export default function Toolbar({
  mode,
  addButtonRef,
  onAdd,
  onDone,
  doneLabel = 'Done',
  onDeselect,
  canMoveFront,
  canMoveBack,
  onFront,
  onBack,
  flipX,
  flipY,
  onMirror,
  onFlip,
  onCrop,
  onDelete,
  onReport,
  onCropReset,
  onCropCancel,
  onCropApply,
}: {
  mode: ToolbarMode
  addButtonRef: Ref<HTMLButtonElement>
  onAdd: () => void
  onDone: () => void
  doneLabel?: string
  onDeselect: () => void
  canMoveFront: boolean
  canMoveBack: boolean
  onFront: () => void
  onBack: () => void
  flipX: boolean
  flipY: boolean
  onMirror: () => void
  onFlip: () => void
  onCrop: () => void
  onDelete: () => void
  // only for layers that came from Pixabay — curated assets aren't reportable
  onReport?: () => void
  onCropReset: () => void
  onCropCancel: () => void
  onCropApply: () => void
}) {
  let buttons: ReactNode
  if (mode === 'crop') {
    buttons = (
      <>
        <ToolButton icon="reset" label="Reset" onClick={onCropReset} ariaLabel="Reset crop to the full image" />
        <ToolButton icon="cancel" label="Cancel" onClick={onCropCancel} />
        <ToolButton icon="done" label="Apply" onClick={onCropApply} variant="primary" />
      </>
    )
  } else if (mode === 'layer') {
    buttons = (
      <>
        <ToolButton icon="close" onClick={onDeselect} ariaLabel="Close layer tools" />
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
        <ToolButton icon="mirror" label="Mirror" onClick={onMirror} pressed={flipX} ariaLabel="Mirror left to right" />
        <ToolButton icon="flip" label="Flip" onClick={onFlip} pressed={flipY} ariaLabel="Flip upside down" />
        <ToolButton icon="crop" label="Crop" onClick={onCrop} />
        <ToolButton icon="delete" label="Delete" onClick={onDelete} variant="danger" />
        {onReport && <ToolButton icon="report" onClick={onReport} ariaLabel="Report this image" />}
      </>
    )
  } else {
    buttons = (
      <>
        <ToolButton icon="add" label="Add" onClick={onAdd} variant="primary" buttonRef={addButtonRef} />
        <ToolButton icon="done" label={doneLabel} onClick={onDone} />
      </>
    )
  }

  return <div className="toolbar">{buttons}</div>
}
