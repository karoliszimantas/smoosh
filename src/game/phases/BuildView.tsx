import { useEffect, useRef, useState } from 'react'
import Canvas, { type CanvasHandle } from '../../components/Canvas'
import type { LayerItem } from '../../components/layerItem'
import type { PhaseProps } from '../types'
import DeadlineTimer from '../DeadlineTimer'
import { useCountdown } from '../useCountdown'
import { canvasStorageKey, loadCanvasItems, clearCanvasItems } from '../canvasStorage'
import { getSessionId } from '../useGameConnection'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'

export default function BuildView({ snapshot }: PhaseProps) {
  const phase = snapshot.phase
  const isBuild = phase.phase === 'build'
  const round = isBuild ? phase.round : 0
  const deadline = isBuild ? phase.deadline : null

  // hooks run unconditionally every render (rules-of-hooks) — the actual
  // phase!=='build' bail-out happens once, right before the JSX below
  const canvasRef = useRef<CanvasHandle>(null)
  const submittedRef = useRef(snapshot.you.hasActedThisPhase)
  const [submitted, setSubmitted] = useState(snapshot.you.hasActedThisPhase)

  const storageKey = canvasStorageKey(snapshot.roomCode, round, snapshot.you.playerId)
  const [initialItems] = useState<LayerItem[] | undefined>(() => loadCanvasItems(storageKey))

  const { remainingMs } = useCountdown(deadline)

  const submit = (blob: Blob): void => {
    if (submittedRef.current) return
    submittedRef.current = true
    setSubmitted(true)
    clearCanvasItems(storageKey)

    void fetch(`${SERVER_URL}/submissions/${snapshot.roomCode}/${round}/${snapshot.you.playerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/webp', 'X-Session-Id': getSessionId() },
      body: blob,
    }).catch((err: unknown) => {
      console.error('submission upload failed', err)
    })
  }

  // auto-submit on timeout with whatever exists
  useEffect(() => {
    if (!isBuild || submittedRef.current || remainingMs > 0) return
    void canvasRef.current?.exportImage()
  }, [remainingMs, isBuild])

  if (phase.phase !== 'build') return null

  return (
    <div className="build-view">
      <DeadlineTimer deadline={phase.deadline} />
      {submitted && <div className="build-waiting-overlay">Submitted — waiting for others…</div>}
      <Canvas
        ref={canvasRef}
        promptText={snapshot.you.secretPrompt ?? ''}
        onSubmit={submit}
        initialItems={initialItems}
        storageKey={submitted ? undefined : storageKey}
      />
    </div>
  )
}
