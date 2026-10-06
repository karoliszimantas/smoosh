import {
  MAX_PROMPT_AUTHOR_LENGTH,
  PROMPT_MODES,
  normalizePromptText,
  promptKey,
  promptProblem,
  type PromptMode,
} from '@smoosh/protocol'
import type { Prompt } from './api'

// Reading a pasted list or a file into prompts, and saying what importing
// them would do — all here in the browser, before anything is sent.
//
// Two shapes, told apart by looking rather than asking:
// - a CSV (or tab-separated, as Sheets copies) whose first row names a
//   `text` column, with optional `mode` and `author` columns
// - anything else: one prompt per line
// Either way: a UTF-8 BOM, Windows line endings, quoted fields and trailing
// commas are fine; blank lines and lines starting with # are skipped.

export type ParsedRow = {
  // 1-based, in the input as pasted — what the preview points at
  line: number
  text: string
  // as written; null when there's no column for it, or the cell is empty
  mode: string | null
  author: string | null
}

export type Parsed = { format: 'lines' | 'table'; rows: ParsedRow[] }

type Record = { line: number; cells: string[] }

// RFC 4180, leniently: "" inside quotes is a quote, a quoted field may run
// over several lines, and anything after a closing quote is kept rather than
// refused
function readRecords(input: string, delimiter: string): Record[] {
  const out: Record[] = []
  let cells: string[] = []
  let cell = ''
  let quoted = false
  let line = 1
  let startLine = 1
  const endRecord = () => {
    cells.push(cell)
    out.push({ line: startLine, cells })
    cells = []
    cell = ''
  }
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else {
        if (ch === '\n') line++
        cell += ch
      }
      continue
    }
    if (ch === '"' && cell.trim() === '') {
      cell = ''
      quoted = true
    } else if (ch === delimiter) {
      cells.push(cell)
      cell = ''
    } else if (ch === '\n') {
      endRecord()
      line++
      startLine = line
    } else {
      cell += ch
    }
  }
  if (cell !== '' || cells.length > 0) endRecord()
  return out
}

const isSkipped = (raw: string) => {
  const t = raw.trim()
  return t === '' || t.startsWith('#')
}

export function parseImport(input: string): Parsed {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  const first = lines.find((l) => !isSkipped(l))
  if (first === undefined) return { format: 'lines', rows: [] }

  // a table only if its first row names a text column
  const delimiter = first.includes('\t') ? '\t' : ','
  const header = readRecords(first, delimiter)[0]?.cells.map((c) => c.trim().toLowerCase()) ?? []
  const textCol = header.indexOf('text')
  if (textCol >= 0) {
    const modeCol = header.indexOf('mode')
    const authorCol = header.indexOf('author')
    const cell = (cells: string[], col: number) => (col >= 0 ? cells[col]?.trim() || null : null)
    let seenHeader = false
    const rows: ParsedRow[] = []
    for (const r of readRecords(text, delimiter)) {
      if (r.cells.every((c) => c.trim() === '') || (r.cells[0] ?? '').trimStart().startsWith('#')) continue
      if (!seenHeader) {
        seenHeader = true
        continue
      }
      rows.push({ line: r.line, text: r.cells[textCol] ?? '', mode: cell(r.cells, modeCol), author: cell(r.cells, authorCol) })
    }
    return { format: 'table', rows }
  }

  const rows: ParsedRow[] = []
  lines.forEach((raw, i) => {
    if (isSkipped(raw)) return
    // a one-column spreadsheet saved as CSV: trailing commas or tabs from
    // empty columns beside it, and quotes around any cell with a comma
    let t = raw.trim().replace(/[,\t]+$/, '').trim()
    const q = /^"(.*)"$/.exec(t)
    if (q?.[1] !== undefined) t = q[1].replace(/""/g, '"')
    rows.push({ line: i + 1, text: t, mode: null, author: null })
  })
  return { format: 'lines', rows }
}

// ---------- what importing would do

export type RowStatus = 'new' | 'duplicate' | 'too_long' | 'invalid'

export type PreviewRow = {
  // stable across re-renders of the same input, for selection
  id: string
  line: number
  text: string
  mode: PromptMode
  author: string
  status: RowStatus
  // why it's not new, in a sentence
  reason: string | null
}

const isMode = (m: string): m is PromptMode => (PROMPT_MODES as readonly string[]).includes(m)

// `me` is whoever is importing; `importAllAs`, if filled in, is everyone's
// author. Otherwise an author column wins, row by row — so a batch someone
// else wrote keeps their name.
export function previewImport(
  rows: readonly ParsedRow[],
  pool: readonly Prompt[],
  who: { me: string; importAllAs: string },
): PreviewRow[] {
  const inPool = new Map(pool.map((p) => [promptKey(p.text), p]))
  const inFile = new Map<string, number>()
  const override = normalizePromptText(who.importAllAs)
  return rows.map((r) => {
    const text = normalizePromptText(r.text)
    const modeRaw = r.mode?.toLowerCase() ?? null
    const mode: PromptMode = modeRaw !== null && isMode(modeRaw) ? modeRaw : 'guess'
    const author = override || normalizePromptText(r.author ?? '') || who.me
    const row = (status: RowStatus, reason: string | null): PreviewRow => ({
      id: `${r.line}:${text}`,
      line: r.line,
      text,
      mode,
      author,
      status,
      reason,
    })

    if (text === '') return row('invalid', 'No text')
    if (modeRaw !== null && !isMode(modeRaw)) return row('invalid', `Mode “${r.mode ?? ''}” — use guess, gallery or both`)
    if (author.length > MAX_PROMPT_AUTHOR_LENGTH) {
      return row('invalid', `Author name over ${MAX_PROMPT_AUTHOR_LENGTH} characters`)
    }

    const key = promptKey(text)
    const existing = inPool.get(key)
    if (existing) {
      return row('duplicate', `Already in the list — ${existing.author} wrote it${existing.archived ? ' (archived)' : ''}`)
    }
    const earlier = inFile.get(key)
    if (earlier !== undefined) return row('duplicate', `Same as line ${earlier}`)
    inFile.set(key, r.line)

    const problem = promptProblem(text, mode)
    if (problem) return row(problem.kind, problem.message)
    return row('new', null)
  })
}

export function summarize(rows: readonly PreviewRow[]): string {
  const n = (s: RowStatus) => rows.filter((r) => r.status === s).length
  const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`
  return [
    `${n('new')} new`,
    n('duplicate') > 0 && plural(n('duplicate'), 'duplicate', 'duplicates'),
    n('too_long') > 0 && `${n('too_long')} too long`,
    n('invalid') > 0 && `${n('invalid')} invalid`,
  ]
    .filter(Boolean)
    .join(' · ')
}
