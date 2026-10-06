// Guess mode: a player who can't picture their prompt may swap it — once,
// in a short window before their build clock starts.

// how many swaps a player gets in one game: roughly one per three rounds —
// 3 rounds: 1, 5: 2, 10: 3 (rounded, not floored: floor would give 5 rounds
// only 1). Scarce on purpose — plentiful swaps get rerolled until something
// easy turns up, and the prompt stops being a constraint
export function swapAllowance(rounds: number): number {
  return Math.max(1, Math.round(rounds / 3))
}

// the window at the start of BUILD, before that player's clock runs: their
// prompt, and the choice to swap it. A ceiling, not a wait — it ends the
// moment they commit, and their build clock only starts when it does, so a
// long one costs nobody but the player using it
export const PROMPT_WINDOW_SEC = 60
// after a swap late in the window: at least this long to read both prompts
// and pick one
export const PROMPT_CHOICE_SEC = 5
