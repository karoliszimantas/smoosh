import Canvas from './components/Canvas'
import ErrorBoundary from './components/ErrorBoundary'

export default function App() {
  return (
    <ErrorBoundary>
      <Canvas />
    </ErrorBoundary>
  )
}