import { useGameConnection } from './useGameConnection'
import type { GameConnection } from './useGameConnection'
import type { RoomSnapshot } from '@smoosh/protocol'
import HomeView from './HomeView'
import LobbyView from './phases/LobbyView'
import BuildView from './phases/BuildView'
import LieView from './phases/LieView'
import GuessView from './phases/GuessView'
import RevealView from './phases/RevealView'
import ScoresView from './phases/ScoresView'
import RateView from './phases/RateView'
import RateResultView from './phases/RateResultView'

export default function GameRoot({ onSandbox }: { onSandbox: () => void }) {
  const { snapshot, connectionStatus, emit } = useGameConnection()

  if (!snapshot) {
    return <HomeView emit={emit} connectionStatus={connectionStatus} onSandbox={onSandbox} />
  }

  return (
    <>
      {connectionStatus === 'reconnecting' && <div className="reconnect-banner">Reconnecting…</div>}
      <PhaseView snapshot={snapshot} emit={emit} />
    </>
  )
}

function PhaseView({ snapshot, emit }: { snapshot: RoomSnapshot; emit: GameConnection['emit'] }) {
  const phase = snapshot.phase

  switch (phase.phase) {
    case 'lobby':
      return <LobbyView snapshot={snapshot} emit={emit} />
    case 'build':
      // keyed by round so BuildView remounts fresh (canvas/timeout state)
      // each round instead of carrying over stale state from the last one
      return <BuildView key={`build-${phase.round}`} snapshot={snapshot} emit={emit} />
    case 'lie':
      return <LieView key={`lie-${phase.round}-${phase.pictureIndex}`} snapshot={snapshot} emit={emit} />
    case 'guess':
      return <GuessView key={`guess-${phase.round}-${phase.pictureIndex}`} snapshot={snapshot} emit={emit} />
    case 'reveal':
      return <RevealView key={`reveal-${phase.round}-${phase.pictureIndex}`} snapshot={snapshot} emit={emit} />
    case 'rate':
      return <RateView key={`rate-${phase.round}-${phase.pictureIndex}`} snapshot={snapshot} emit={emit} />
    case 'rateResult':
      return <RateResultView key={`rateResult-${phase.round}-${phase.pictureIndex}`} snapshot={snapshot} emit={emit} />
    case 'scores':
      return <ScoresView key={`scores-${phase.round}`} snapshot={snapshot} emit={emit} />
  }
}
