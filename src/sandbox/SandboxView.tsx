import { useEffect, useState } from 'react'
import Canvas from '../components/Canvas'
import type { LayerItem } from '../components/layerItem'
import { clearCanvasItems, loadCanvasItems } from '../game/canvasStorage'
import { SANDBOX_PROMPTS } from './prompts'

// The canvas with the game taken away: no room, no socket, no timer, no
// submission. It is the same Canvas BuildView mounts — just without an
// onSubmit (so Export downloads) and persisting to localStorage, so a scene
// survives closing the tab.
const CANVAS_KEY = 'smoosh_sandbox_canvas'
const PROMPT_KEY = 'smoosh_sandbox_prompt'

function randomPrompt(exclude?: string): string {
  const choices = SANDBOX_PROMPTS.filter((p) => p !== exclude)
  return choices[Math.floor(Math.random() * choices.length)] ?? SANDBOX_PROMPTS[0] ?? ''
}

function loadPrompt(): string | null {
  try {
    return localStorage.getItem(PROMPT_KEY)
  } catch {
    return null
  }
}

function savePrompt(prompt: string): void {
  try {
    localStorage.setItem(PROMPT_KEY, prompt)
  } catch {
    // best effort — a fresh prompt next time is fine
  }
}

export default function SandboxView({ onExit }: { onExit: () => void }) {
  // the saved prompt comes back with the saved scene — the composition was
  // built for it
  const [prompt, setPrompt] = useState(() => loadPrompt() || randomPrompt())
  const [initialItems, setInitialItems] = useState<LayerItem[] | undefined>(() =>
    loadCanvasItems(CANVAS_KEY, 'local'),
  )
  // Canvas owns its items; clearing remounts it empty rather than reaching in
  const [canvasKey, setCanvasKey] = useState(0)

  useEffect(() => {
    savePrompt(prompt)
  }, [prompt])

  const clear = () => {
    if (!window.confirm('Clear the canvas? This removes every layer.')) return
    clearCanvasItems(CANVAS_KEY, 'local')
    setInitialItems([])
    setCanvasKey((k) => k + 1)
  }

  return (
    <div className="sandbox-view">
      <div className="sandbox-bar">
        <button onClick={onExit}>
          <span aria-hidden="true">←</span> Exit
        </button>
        <button onClick={() => setPrompt((p) => randomPrompt(p))} aria-label="Shuffle prompt">
          <span aria-hidden="true">⤮</span> New prompt
        </button>
        <button onClick={clear}>Clear canvas</button>
      </div>
      <Canvas
        key={canvasKey}
        promptText={prompt}
        initialItems={initialItems}
        storageKey={CANVAS_KEY}
        storageArea="local"
        doneLabel="Export"
      />
    </div>
  )
}
