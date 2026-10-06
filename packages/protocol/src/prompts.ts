// What makes a prompt acceptable — one set of rules for the /prompts page,
// its import preview, and the server that has the final say.

export const PROMPT_MODES = ['guess', 'gallery', 'both'] as const
export type PromptMode = (typeof PROMPT_MODES)[number]

export const PROMPT_MIN_CHARS = 3
// Guess prompts are read off the prompt bar mid-round and then guessed, so
// they're short; Gallery prompts only need to fit the bar
export const GUESS_MAX_WORDS = 5
export const GUESS_MAX_CHARS = 32
export const GALLERY_MAX_CHARS = 120

// trimmed, inner whitespace collapsed — what's stored
export function normalizePromptText(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

// what duplicates are compared on: normalised, any case
export function promptKey(text: string): string {
  return normalizePromptText(text).toLowerCase()
}

export function wordCount(text: string): number {
  const t = normalizePromptText(text)
  return t === '' ? 0 : t.split(' ').length
}

export type PromptProblem =
  | { kind: 'too_long'; words: number; chars: number; message: string }
  | { kind: 'invalid'; message: string }

// null when `text` (already normalised) is fine for `mode`. 'both' is dealt
// into Guess games too, so it takes the Guess rule. Never fixes anything —
// a prompt is flagged, and a person decides.
export function promptProblem(text: string, mode: PromptMode): PromptProblem | null {
  const chars = [...text].length
  const words = wordCount(text)
  if (chars < PROMPT_MIN_CHARS) return { kind: 'invalid', message: `A prompt needs at least ${PROMPT_MIN_CHARS} characters` }
  if (mode === 'gallery') {
    if (chars > GALLERY_MAX_CHARS) {
      return { kind: 'too_long', words, chars, message: `${chars} characters — Gallery allows ${GALLERY_MAX_CHARS}` }
    }
    return null
  }
  if (words > GUESS_MAX_WORDS || chars > GUESS_MAX_CHARS) {
    const label = mode === 'both' ? 'Guess (and Both)' : 'Guess'
    return {
      kind: 'too_long',
      words,
      chars,
      message: `${words} words, ${chars} characters — ${label} allows ${GUESS_MAX_WORDS} words, ${GUESS_MAX_CHARS} characters`,
    }
  }
  if (text.endsWith('.')) return { kind: 'invalid', message: 'Ends with a full stop — Guess prompts don’t' }
  return null
}

export const MAX_PROMPT_AUTHOR_LENGTH = 24
// the most prompts one import may carry
export const MAX_IMPORT_ROWS = 200
