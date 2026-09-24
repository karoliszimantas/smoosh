export type AssignPromptsResult = {
  assignments: Map<string, string>
  used: string[]
}

// pure — no Room/Socket.io coupling. Throws if the pool can't cover every
// player; callers are expected to check `pool.length >= playerIds.length`
// up front (e.g. at room:start) so this never fires mid-game.
export function assignPrompts(
  playerIds: readonly string[],
  availablePool: readonly string[],
  rng: () => number = Math.random,
): AssignPromptsResult {
  if (availablePool.length < playerIds.length) {
    throw new Error(
      `not enough prompts: need ${playerIds.length}, pool has ${availablePool.length} remaining`,
    )
  }

  const shuffled = [...availablePool]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const a = shuffled[i]
    const b = shuffled[j]
    if (a === undefined || b === undefined) continue
    shuffled[i] = b
    shuffled[j] = a
  }

  const picked = shuffled.slice(0, playerIds.length)
  const assignments = new Map<string, string>()
  playerIds.forEach((playerId, i) => {
    const prompt = picked[i]
    if (prompt === undefined) throw new Error('internal error: prompt/player length mismatch')
    assignments.set(playerId, prompt)
  })

  return { assignments, used: picked }
}
