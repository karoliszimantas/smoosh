import { useState } from 'react'
import Canvas from '../components/Canvas'
import { clearCanvasItems } from '../game/canvasStorage'

// one test canvas, emptied for every prompt — each build starts fresh, and
// survives a reload only until the next prompt is built
const TEST_CANVAS_KEY = 'smoosh_prompt_test_canvas'

// The sandbox, with a prompt from the list. The prompt bar (and the asset
// sheet's prompt-word tabs) come from the prompt; the bar on top is the
// verdict: Works / Doesn't work records a vote and goes back to the list.
export default function PromptTestView({
  prompt,
  onDone,
}: {
  prompt: string
  // null: back without judging
  onDone: (verdict: 1 | -1 | null) => void
}) {
  // cleared once per mount, before the canvas first reads it
  useState(() => clearCanvasItems(TEST_CANVAS_KEY))

  return (
    <div className="sandbox-view prompt-test">
      <div className="sandbox-bar">
        <button onClick={() => onDone(null)}>
          <span aria-hidden="true">←</span> Prompts
        </button>
        <button className="prompt-test-yes" onClick={() => onDone(1)}>
          👍 Works
        </button>
        <button className="prompt-test-no" onClick={() => onDone(-1)}>
          👎 Doesn&apos;t work
        </button>
      </div>
      <Canvas promptText={prompt} storageKey={TEST_CANVAS_KEY} doneLabel="Export" />
    </div>
  )
}
