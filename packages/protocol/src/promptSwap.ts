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
// prompt, and the choice to swap it
export const PROMPT_WINDOW_SEC = 5
// after a swap: long enough to read both prompts and pick one
export const PROMPT_CHOICE_SEC = 5
