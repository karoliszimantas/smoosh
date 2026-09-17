import { Component, type ReactNode } from 'react'

// Covers the DOM-rendered tree (this component's own children, Drawer, etc.).
// It does NOT catch errors thrown inside <Stage>/<Layer>/DraggableImage —
// react-konva mounts those through its own internal react-reconciler root,
// which is a separate error-boundary scope entirely. A throw in there is
// swallowed by react-konva's default handler (logged, that root unmounts),
// not by any boundary in the DOM tree, however high it's placed. Verified
// empirically: wrapping <Canvas/> here does not catch a forced throw in
// DraggableImage.

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  override componentDidCatch(error: unknown, info: { componentStack?: string | null }): void {
    console.error('canvas crashed', error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="error-fallback">
          <p>Something went wrong.</p>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      )
    }
    return this.props.children
  }
}
