import GameRoot from './game/GameRoot'
import ErrorBoundary from './components/ErrorBoundary'

export default function App() {
  return (
    <ErrorBoundary>
      <GameRoot />
    </ErrorBoundary>
  )
}
