// canonical sources.csv column order — the header row, cut.ts's reads, and
// fetch.ts's writes all derive from this single list
export const SOURCE_ROW_COLUMNS = [
  'filename',
  'category',
  'source',
  'source_url',
  'license',
  'published_date',
  'has_people',
  'downloaded_at',
] as const

export type SourceRowColumn = (typeof SOURCE_ROW_COLUMNS)[number]

export type SourceRow = Record<SourceRowColumn, string>
