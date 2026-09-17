import type { Ref } from 'react'

export default function Toolbar({
  addButtonRef,
  onAdd,
  onDone,
  isSelected,
  canMoveFront,
  canMoveBack,
  onFront,
  onBack,
  onDelete,
}: {
  addButtonRef: Ref<HTMLButtonElement>
  onAdd: () => void
  onDone: () => void
  isSelected: boolean
  canMoveFront: boolean
  canMoveBack: boolean
  onFront: () => void
  onBack: () => void
  onDelete: () => void
}) {
  return (
    <div className="toolbar">
      <button ref={addButtonRef} className="toolbar-btn toolbar-btn-primary" onClick={onAdd}>
        <span aria-hidden="true">+</span> Add
      </button>

      {isSelected && (
        <>
          <button
            className="toolbar-btn"
            onClick={onFront}
            disabled={!canMoveFront}
            aria-label="Move layer to front"
          >
            <span aria-hidden="true">▲</span> Front
          </button>
          <button
            className="toolbar-btn"
            onClick={onBack}
            disabled={!canMoveBack}
            aria-label="Move layer to back"
          >
            <span aria-hidden="true">▼</span> Back
          </button>
          <button className="toolbar-btn toolbar-btn-danger" onClick={onDelete}>
            <span aria-hidden="true">✕</span> Delete
          </button>
        </>
      )}

      <button className="toolbar-btn" onClick={onDone}>
        Done
      </button>
    </div>
  )
}
