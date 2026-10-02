import { score, type Prompt } from './api'

// The pool is a working document; what ships is a reviewed snapshot in the
// repo. This produces src/sandbox/prompts.ts: every non-archived prompt with
// a positive score, best first. The game keeps reading that file, never the
// API — prompts must work with the prompt service down.
export function promptsAsTs(prompts: readonly Prompt[], now: Date = new Date()): string {
  const keep = prompts
    .filter((p) => !p.archived && score(p) > 0)
    .sort((a, b) => score(b) - score(a) || a.text.localeCompare(b.text))
  // JSON.stringify gives a valid TS string literal for any text; the trailing
  // comment is for the reviewer (author and mode are single-line, the server
  // collapses whitespace)
  const lines = keep.map((p) => `  ${JSON.stringify(p.text)}, // +${score(p)} ${p.mode}, ${p.author}`)
  return [
    `// Exported from the team prompt list on ${now.toISOString().slice(0, 10)}:`,
    `// ${keep.length} non-archived prompt${keep.length === 1 ? '' : 's'} with a positive score, best first.`,
    '// Review before committing — this file is what reaches players.',
    'export const SANDBOX_PROMPTS: readonly string[] = [',
    ...lines,
    ']',
    '',
  ].join('\n')
}
