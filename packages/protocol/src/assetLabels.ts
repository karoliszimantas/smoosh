// tools/asset-labels.tsv: the hand-written label and search tags for every
// asset. One reader and one writer for it, shared by the cut pipeline, the
// sync script, the game server's /labels tool and its page — so a row saved
// by the tool and a row typed in an editor come out byte for byte the same.
//
// Format: '#' comment lines, then a tab-separated header, then one row per
// asset. Tags are comma-separated (written ", "). remove is empty or "yes".
// Newer files add edited_by and edited_at at the end; older ones without
// them still read.

export const LABEL_COLUMNS = ['id', 'category', 'label', 'tags', 'remove', 'note', 'edited_by', 'edited_at'] as const
export type LabelColumn = (typeof LABEL_COLUMNS)[number]
const REQUIRED: readonly LabelColumn[] = ['id', 'category', 'label', 'tags', 'remove', 'note']

export type LabelRow = {
  id: string
  category: string
  label: string
  tags: string[]
  remove: boolean
  note: string
  // who last changed the row through the /labels tool, and when (ISO) —
  // empty for rows only ever edited by hand
  editedBy: string
  editedAt: string
}

export type LabelsDoc = {
  // the comment block at the top, kept as written
  preamble: string[]
  header: LabelColumn[]
  rows: LabelRow[]
}

const CELL_FORBIDDEN = /[\t\r\n]/

// Plain-language problems with one row as someone would enter it — the
// tool shows these, and the file reader reports the same ones.
export function rowProblems(row: Pick<LabelRow, 'id' | 'category' | 'label' | 'tags' | 'note'>, rawTags?: string): string[] {
  const problems: string[] = []
  if (!row.id || /\s/.test(row.id)) problems.push(`The id "${row.id}" is empty or has spaces.`)
  else if (!row.id.startsWith(`${row.category}-`)) problems.push(`${row.id} doesn't belong to the category "${row.category}".`)
  for (const [what, value] of [
    ['label', row.label],
    ['note', row.note],
    ...row.tags.map((t) => ['tag', t] as const),
  ] as const) {
    if (CELL_FORBIDDEN.test(value)) problems.push(`The ${what} "${value.replace(/[\t\r\n]+/g, ' ')}" has a tab or line break in it — those split the file's columns. Take it out.`)
  }
  if (row.tags.some((t) => t.includes(','))) problems.push('A tag has a comma in it — commas separate tags.')
  if (rawTags !== undefined && rawTags.trim() !== '' && rawTags.split(',').some((t) => t.trim() === '')) {
    problems.push('The tags have an empty entry — a stray or trailing comma?')
  }
  return problems
}

export function parseLabels(text: string): { doc: LabelsDoc; problems: string[] } {
  const problems: string[] = []
  const lines = text.split(/\r?\n/)
  const preamble: string[] = []
  let i = 0
  while (i < lines.length && (lines[i] ?? '').startsWith('#')) preamble.push(lines[i++] ?? '')
  const headerCells = (lines[i++] ?? '').split('\t').map((h) => h.trim())
  const unknown = headerCells.filter((h) => !(LABEL_COLUMNS as readonly string[]).includes(h))
  const missing = REQUIRED.filter((c) => !headerCells.includes(c))
  if (unknown.length > 0 || missing.length > 0) {
    if (missing.length > 0) problems.push(`The header is missing column(s): ${missing.join(', ')}.`)
    if (unknown.length > 0) problems.push(`The header has unknown column(s): ${unknown.join(', ')}.`)
    return { doc: { preamble, header: [...REQUIRED], rows: [] }, problems }
  }
  const header = headerCells as LabelColumn[]
  const rows: LabelRow[] = []
  const seen = new Set<string>()
  for (; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line.trim() === '' || line.startsWith('#')) continue
    const at = `Line ${i + 1}`
    const cells = line.split('\t')
    if (cells.length !== header.length) {
      problems.push(`${at}: ${cells.length} cells where there should be ${header.length} — is there a tab inside a cell?`)
      continue
    }
    const cell = (c: LabelColumn) => (header.includes(c) ? (cells[header.indexOf(c)] ?? '').trim() : '')
    const rawTags = cell('tags')
    const remove = cell('remove').toLowerCase()
    const row: LabelRow = {
      id: cell('id'),
      category: cell('category'),
      label: cell('label'),
      tags: rawTags
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
      remove: remove === 'yes',
      note: cell('note'),
      editedBy: cell('edited_by'),
      editedAt: cell('edited_at'),
    }
    for (const p of rowProblems(row, rawTags)) problems.push(`${at}: ${p}`)
    if (remove !== '' && remove !== 'yes') problems.push(`${at}: remove is "${cell('remove')}" — leave it empty or write yes.`)
    if (!row.label && !row.remove) problems.push(`${at}: ${row.id} has no label.`)
    if (seen.has(row.id)) problems.push(`${at}: ${row.id} appears twice.`)
    seen.add(row.id)
    rows.push(row)
  }
  return { doc: { preamble, header, rows }, problems }
}

function cellOf(row: LabelRow, c: LabelColumn): string {
  switch (c) {
    case 'id':
      return row.id
    case 'category':
      return row.category
    case 'label':
      return row.label
    case 'tags':
      return row.tags.join(', ')
    case 'remove':
      return row.remove ? 'yes' : ''
    case 'note':
      return row.note
    case 'edited_by':
      return row.editedBy
    case 'edited_at':
      return row.editedAt
  }
}

// The file, written the way the existing one is: comments, header, rows,
// tabs between cells, a newline at the end. A doc that has attribution in
// it gains the two columns at the end of every row.
export function serializeLabels(doc: LabelsDoc): string {
  const attributed = doc.rows.some((r) => r.editedBy || r.editedAt)
  const header: LabelColumn[] =
    attributed && !doc.header.includes('edited_by') ? [...doc.header, 'edited_by', 'edited_at'] : doc.header
  const lines = [...doc.preamble, header.join('\t'), ...doc.rows.map((r) => header.map((c) => cellOf(r, c)).join('\t'))]
  return `${lines.join('\n')}\n`
}
