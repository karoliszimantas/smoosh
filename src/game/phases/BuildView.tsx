import { useEffect, useRef, useState } from 'react'
import Canvas, { type CanvasHandle } from '../../components/Canvas'
import type { LayerItem } from '../../components/layerItem'
import type { PhaseProps } from '../types'
import DeadlineTimer from '../DeadlineTimer'
import { useCountdown } from '../useCountdown'
import { canvasStorageKey, loadCanvasItems, clearCanvasItems } from '../canvasStorage'
import { SERVER_URL } from '../serverUrl'
import { useGameServices } from '../services'
import { uploadPicture } from '../upload'
import UploadStatus, { type UploadState, type WaitingFor } from '../UploadStatus'
import PromptWindow from './PromptWindow'

// freestyle gets an empty prompt from the server; the bar still shows (so
// the layout is the same in every mode) with this instead
const FREESTYLE_PROMPT = 'Build whatever you want'

type BuildViewProps = PhaseProps & {
  // for news that has to outlive this view — an upload refused after the
  // round has already moved on
  onNotice: (message: string) => void
}

export default function BuildView({ snapshot, emit, onNotice }: BuildViewProps) {
  const { upload: send } = useGameServices()
  const phase = snapshot.phase
  const isBuild = phase.phase === 'build'
  const round = isBuild ? phase.round : 0
  // this player's own clock: it starts when their prompt window closes
  const deadline = isBuild ? (snapshot.you.build?.deadline ?? phase.deadline) : null

  // hooks run unconditionally every render (rules-of-hooks) — the actual
  // phase!=='build' bail-out happens once, right before the JSX below
  const canvasRef = useRef<CanvasHandle>(null)
  // an upload is in flight or has landed — no second one
  const busyRef = useRef(snapshot.you.hasActedThisPhase)
  // the timeout auto-submit fires once; after a failure a retry is the
  // player's tap, not a loop on every countdown tick
  const autoSubmittedRef = useRef(false)
  const mountedRef = useRef(true)
  const [upload, setUpload] = useState<UploadState>(
    snapshot.you.hasActedThisPhase ? { status: 'submitted' } : { status: 'editing' },
  )
  // "Submitted" only once the server has it: its ack, or a snapshot that
  // says so (e.g. after a reload)
  const submitted = upload.status === 'submitted' || snapshot.you.hasActedThisPhase
  const shownState: UploadState = submitted ? { status: 'submitted' } : upload

  const storageKey = canvasStorageKey(snapshot.roomCode, round, snapshot.you.playerId)
  const [initialItems] = useState<LayerItem[] | undefined>(() => loadCanvasItems(storageKey, 'local'))

  const { remainingMs } = useCountdown(deadline)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const submit = async (blob: Blob): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setUpload({ status: 'sending' })

    const url = `${SERVER_URL}/submissions/${snapshot.roomCode}/${round}/${snapshot.you.playerId}`
    const result = await uploadPicture(send, url, blob)
    if (result.ok) {
      clearCanvasItems(storageKey, 'local')
      setUpload({ status: 'submitted' })
      return
    }
    busyRef.current = false
    setUpload({ status: 'failed', message: result.message, canRetry: !result.final })
    // a refusal means the round has moved on (or is about to), and a
    // failure after this view is gone has nowhere else to show — either way,
    // say so on whatever screen the player is on next
    if (result.final || !mountedRef.current) onNotice(result.message)
  }

  // auto-submit with whatever exists when time runs out — by this phone's
  // clock, or when the server says it's collecting, whichever comes first
  const collecting = isBuild && phase.collecting
  useEffect(() => {
    if (!isBuild || busyRef.current || autoSubmittedRef.current) return
    if (remainingMs > 0 && !collecting) return
    autoSubmittedRef.current = true
    void canvasRef.current?.exportImage()
  }, [remainingMs, isBuild, collecting])

  if (phase.phase !== 'build') return null

  const waitingFor: WaitingFor[] = snapshot.waitingOn
    .filter((id) => id !== snapshot.you.playerId)
    .flatMap((id) => {
      const player = snapshot.players.find((p) => p.id === id)
      return player ? [{ id, name: player.name, away: player.presence === 'away' }] : []
    })
  const freestyle = snapshot.settings.mode === 'gallery' && !snapshot.settings.prompted
  const prompt = snapshot.you.secretPrompt ?? ''

  return (
    <div className="build-view">
      <DeadlineTimer deadline={deadline} />
      <UploadStatus
        state={shownState}
        onRetry={() => void canvasRef.current?.exportImage()}
        waitingFor={waitingFor}
      />
      <Canvas
        ref={canvasRef}
        promptText={freestyle || !prompt ? FREESTYLE_PROMPT : prompt}
        freestyle={freestyle}
        allowPhotos={snapshot.settings.allowPhotos}
        onSubmit={(blob) => void submit(blob)}
        initialItems={initialItems}
        storageKey={submitted ? undefined : storageKey}
        // survives the tab being closed, not just reloaded
        storageArea="local"
      />
      {snapshot.you.build && !submitted && (
        <PromptWindow round={round} prompt={prompt} build={snapshot.you.build} emit={emit} />
      )}
    </div>
  )
}
