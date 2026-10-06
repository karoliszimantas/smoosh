import type { GameMode } from '@smoosh/protocol'
import { PROMPT_POOL } from '../game/promptPool.ts'
import { getPromptStore } from './shared.ts'

// Where a new game's prompts come from: the team's list on the /prompts page
// (R2 in production) — live, not archived, and meant for this mode or both.
// If that list can't be reached yet, or has nothing for this mode, the
// generated pool stands in, so a game can always start; the log says so.
export function gamePrompts(mode: GameMode): readonly string[] {
  // chain prompts are read, then built to, like Guess's — short ones
  const listed = getPromptStore().playable(mode === 'chain' ? 'guess' : mode)
  if (listed === null) {
    console.warn(`[prompts] list not loaded — ${mode} game uses the generated pool`)
    return PROMPT_POOL
  }
  if (listed.length === 0) {
    console.warn(`[prompts] no live ${mode} prompts in the list — game uses the generated pool`)
    return PROMPT_POOL
  }
  return listed
}
