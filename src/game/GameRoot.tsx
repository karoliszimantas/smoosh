import { useCallback, useEffect, useRef, useState } from 'react'
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
import FinalView from './phases/FinalView'
import { showsExhibition } from './finalStandings'
import VoteView from './phases/VoteView'
import AwardsView from './phases/AwardsView'
import ChainRevealView from './chain/ChainRevealView'
import ChainVoteView from './chain/ChainVoteView'
import ChainAwardsView from './chain/ChainAwardsView'
import MissingView from './phases/MissingView'
import GameMenu from './GameMenu'
import LeaveDialog from './LeaveDialog'
import NoticeRegion from './NoticeRegion'
import StatusStrip from './StatusStrip'
import PromptWindowHeader from './PromptWindowHeader'
import { statusLine } from './statusLine'
import { promptWindowEndsAt, useBefore } from './promptWindow'
import ReplacedView from './ReplacedView'
import { useStuckWatchdog } from './stuckWatchdog'
import { RECONNECTING_BUILD_TEXT, RECONNECTING_TEXT, STUCK_TEXT } from './roomMessages'
import ThemeSwitcher from '../themes/ThemeSwitcher'
import { forgetInvite, invitedRoom, stillInGameText } from './invite'

// on Home and on screens without a status strip (but not the lobby, which
// shows the full swatch row): one swatch in the corner. In a round it's in
// the strip. The theme never leaves this device — nothing goes over the socket.
function FloatingThemeSwitcher() {
  return (
    <div className="theme-switcher-float">
      <ThemeSwitcher variant="compact" />
    </div>
  )
}

// Browser back (or the iOS edge swipe) in a game shouldn't quietly walk out
// of it: an extra history entry absorbs the back, and the leave question is
// asked instead.
function useBackGuard(active: boolean, onBack: () => void): void {
  useEffect(() => {
    if (!active) return
    history.pushState({ smooshGuard: true }, '')
    const onPop = () => {
      history.pushState({ smooshGuard: true }, '')
      onBack()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [active, onBack])
}

export default function GameRoot({ onSandbox }: { onSandbox: () => void }) {
  const game = useGameConnection()
  const { snapshot, emit } = game
  // something the player must see whatever phase it is now — e.g. their
  // picture was refused after the round moved on
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const openLeave = useCallback(() => setConfirmLeave(true), [])
  useBackGuard(snapshot !== null, openLeave)
  // opened from an invite but put straight back into the game they still
  // had a seat in: said once. The invitation waits for the home screen,
  // should they leave
  const roomCode = snapshot?.roomCode ?? null
  const [inviteCheckedFor, setInviteCheckedFor] = useState<string | null>(null)
  if (roomCode && roomCode !== inviteCheckedFor) {
    setInviteCheckedFor(roomCode)
    const invited = invitedRoom()
    if (invited === roomCode) forgetInvite()
    else if (invited) setNotice((n) => n ?? stillInGameText(roomCode, invited))
  }
  // the phase's own screen, watched for the one state nobody can get out
  // of alone: the room waiting on them, nothing for them to press
  const phaseRoot = useRef<HTMLDivElement>(null)
  const { stuck, reset: resetWatchdog } = useStuckWatchdog(snapshot, phaseRoot)
  // this player's prompt window, before their build clock starts: it takes
  // the screen, and its own header stands in for the strip
  const windowEndsAt = promptWindowEndsAt(snapshot)
  const promptWindowOpen = useBefore(windowEndsAt)
  const rejoin = {
    label: 'Rejoin',
    onClick: () => {
      resetWatchdog()
      game.rejoinNow()
    },
  }

  if (game.replaced) return <ReplacedView onPlayHere={game.playHere} />

  if (!snapshot) {
    return (
      <>
        <FloatingThemeSwitcher />
        <HomeView
          emit={emit}
          connectionStatus={game.connectionStatus}
          onSandbox={onSandbox}
          notice={game.homeNotice}
          lastRoomCode={game.lastRoomCode}
        />
        <NoticeRegion
          alert={game.rejoinProblem}
          {...(game.rejoinProblem ? { alertAction: rejoin } : {})}
          toasts={game.toasts}
          onToastDone={game.dismissToast}
        />
      </>
    )
  }

  const isLobby = snapshot.phase.phase === 'lobby'
  // a canvas on screen, saved on this phone as it changes
  const building = snapshot.phase.phase === 'build' || snapshot.phase.phase === 'pass'
  // in a round: the status strip over the phase's screen, holding the clock,
  // who's done, the theme switch and the menu
  const status = statusLine(snapshot)
  return (
    <>
      {!status && !isLobby && <FloatingThemeSwitcher />}
      {!status && <GameMenu roomCode={snapshot.roomCode} isLobby={isLobby} onLeave={openLeave} />}
      <div className={status ? 'game-screen' : 'game-screen bare'}>
        {status &&
          (promptWindowOpen && windowEndsAt !== null ? (
            <PromptWindowHeader snapshot={snapshot} round={status.round} windowEndsAt={windowEndsAt} onLeave={openLeave} />
          ) : (
            <StatusStrip snapshot={snapshot} status={status} onLeave={openLeave} />
          ))}
        <div className="phase-root" ref={phaseRoot}>
          <PhaseView
            snapshot={snapshot}
            emit={emit}
            onNotice={setNotice}
            onLeave={openLeave}
            promptWindowOpen={promptWindowOpen}
          />
        </div>
      </div>
      <NoticeRegion
        reconnecting={game.showReconnecting}
        reconnectingText={building ? RECONNECTING_BUILD_TEXT : RECONNECTING_TEXT}
        // a problem with a way out comes first; then news to dismiss
        alert={game.rejoinProblem ?? (stuck ? STUCK_TEXT : notice)}
        {...(game.rejoinProblem || stuck ? { alertAction: rejoin } : {})}
        onDismissAlert={() => setNotice(null)}
        toasts={game.toasts}
        onToastDone={game.dismissToast}
      />
      {confirmLeave && (
        <LeaveDialog
          roomCode={snapshot.roomCode}
          isLobby={isLobby}
          isHost={snapshot.you.isHost}
          onStay={() => setConfirmLeave(false)}
          onLeave={() => {
            setConfirmLeave(false)
            void game.leave()
          }}
        />
      )}
    </>
  )
}

function PhaseView({
  snapshot,
  emit,
  onNotice,
  onLeave,
  promptWindowOpen,
}: {
  snapshot: RoomSnapshot
  emit: GameConnection['emit']
  onNotice: (message: string) => void
  onLeave: () => void
  promptWindowOpen: boolean
}) {
  const phase = snapshot.phase

  switch (phase.phase) {
    case 'lobby':
      return <LobbyView snapshot={snapshot} emit={emit} />
    case 'build':
      // keyed by round so BuildView remounts fresh (canvas/timeout state)
      // each round instead of carrying over stale state from the last one
      return (
        <BuildView
          key={`build-${phase.round}`}
          snapshot={snapshot}
          emit={emit}
          onNotice={onNotice}
          promptWindowOpen={promptWindowOpen}
        />
      )
    case 'lie':
      return <LieView key={`lie-${phase.round}-${phase.pictureIndex}`} snapshot={snapshot} emit={emit} />
    case 'guess':
      return <GuessView key={`guess-${phase.round}-${phase.pictureIndex}`} snapshot={snapshot} emit={emit} />
    case 'reveal':
      return <RevealView key={`reveal-${phase.round}-${phase.pictureIndex}`} snapshot={snapshot} emit={emit} />
    case 'pass':
      // keyed by pass, like BUILD by round: a fresh canvas for each
      return <BuildView key={`pass-${phase.unit}`} snapshot={snapshot} emit={emit} onNotice={onNotice} />
    case 'chainReveal':
      return <ChainRevealView key={`chainReveal-${phase.round}`} snapshot={snapshot} emit={emit} />
    case 'chainVote':
      return <ChainVoteView key={`chainVote-${phase.round}`} snapshot={snapshot} emit={emit} />
    case 'chainAwards':
      return <ChainAwardsView key={`chainAwards-${phase.round}`} snapshot={snapshot} emit={emit} />
    case 'vote':
      return <VoteView key={`vote-${phase.round}`} snapshot={snapshot} emit={emit} />
    case 'awards':
      return <AwardsView key={`awards-${phase.round}`} snapshot={snapshot} emit={emit} />
    case 'missing':
      return <MissingView key={`missing-${phase.round}-${phase.pictureIndex}`} snapshot={snapshot} emit={emit} />
    case 'scores':
      // the game's end: the podium (Gallery's own ending, the exhibition,
      // stays with the scores)
      if (phase.isFinalRound && !showsExhibition(snapshot)) {
        return <FinalView key={`final-${phase.round}`} snapshot={snapshot} emit={emit} onLeave={onLeave} />
      }
      return <ScoresView key={`scores-${phase.round}`} snapshot={snapshot} emit={emit} />
  }
}
