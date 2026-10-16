import { useEffect, useRef } from 'react'

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'

// A modal's keyboard manners, for the dialog the returned ref is put on:
// focus moves in as it opens (to its [data-autofocus] element, else the
// dialog itself), Tab stays inside, Esc closes, and as it closes focus goes
// back to whatever opened it — or to `returnFocus()`, when that's gone
// (a menu item, say, closed with its menu).
export function useDialog<T extends HTMLElement>(onClose: () => void, returnFocus?: () => HTMLElement | null) {
  const ref = useRef<T>(null)
  const closeRef = useRef(onClose)
  const returnRef = useRef(returnFocus)
  useEffect(() => {
    closeRef.current = onClose
    returnRef.current = returnFocus
  })

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const node = ref.current
    ;(node?.querySelector<HTMLElement>('[data-autofocus]') ?? node)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab' || !node) return
      const focusable = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)]
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      const at = document.activeElement
      if (e.shiftKey && (at === first || at === node || !node.contains(at))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (at === last || !node.contains(at))) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const back = opener?.isConnected ? opener : returnRef.current?.()
      back?.focus()
    }
  }, [])

  return ref
}
