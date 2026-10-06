import { score, type Prompt } from './api'

// The pool (or whatever the filters show of it) as a spreadsheet: edit it in
// Sheets or Excel, then bring it back through Import. Its text, mode and
// author columns are exactly what Import reads; the rest is for reading.

const COLUMNS = ['text', 'mode', 'author', 'score', 'buildCount', 'archived'] as const

function cell(value: string | number | boolean): string {
  const s = String(value)
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function promptsAsCsv(prompts: readonly Prompt[]): string {
  const rows = prompts.map((p) =>
    [p.text, p.mode, p.author, score(p), p.buildCount, p.archived].map(cell).join(','),
  )
  // CRLF and a BOM: what Excel needs to open UTF-8 (accents, emoji) correctly
  return `\uFEFF${[COLUMNS.join(','), ...rows].join('\r\n')}\r\n`
}

export function downloadCsv(csv: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // let the download start before the URL goes
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
