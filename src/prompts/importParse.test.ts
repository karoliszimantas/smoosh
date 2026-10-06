import { describe, it, expect } from 'vitest'
import { parseImport, previewImport, summarize, type PreviewRow } from './importParse'
import { promptsAsCsv } from './exportCsv'
import type { Prompt } from './api'

const prompt = (text: string, author = 'Ana', extra: Partial<Prompt> = {}): Prompt => ({
  id: text,
  text,
  mode: 'guess',
  author,
  createdAt: '2026-10-01T00:00:00Z',
  archived: false,
  votes: {},
  buildCount: 0,
  ...extra,
})
const who = { me: 'Karolis', importAllAs: '' }
const preview = (input: string, pool: Prompt[] = [], w = who) => previewImport(parseImport(input).rows, pool, w)
const statuses = (rows: PreviewRow[]) => rows.map((r) => r.status)

describe('reading an import', () => {
  it('a bare list is one prompt per line; blanks and # lines skipped', () => {
    const p = parseImport('Goat on a Bike\n\n# a note\n  Owl at the Dentist  \n')
    expect(p.format).toBe('lines')
    expect(p.rows.map((r) => [r.line, r.text.trim()])).toEqual([
      [1, 'Goat on a Bike'],
      [4, 'Owl at the Dentist'],
    ])
  })

  it('a CSV saved from Sheets or Excel: BOM, CRLF, quotes, embedded commas and quotes, trailing commas', () => {
    const csv = '\uFEFFtext,mode,author,\r\n"Goat, on a Bike",guess,Ben,\r\n"The ""Big"" Owl",Gallery,,\r\nSloth Napping,,,\r\n,,,\r\n'
    const p = parseImport(csv)
    expect(p.format).toBe('table')
    expect(p.rows).toEqual([
      { line: 2, text: 'Goat, on a Bike', mode: 'guess', author: 'Ben' },
      { line: 3, text: 'The "Big" Owl', mode: 'Gallery', author: null },
      { line: 4, text: 'Sloth Napping', mode: null, author: null },
    ])
  })

  it('columns in any order, any case; tab-separated as Sheets copies', () => {
    expect(parseImport('Author\tTEXT\nBen\tGoat on a Bike').rows).toEqual([
      { line: 2, text: 'Goat on a Bike', mode: null, author: 'Ben' },
    ])
  })

  it('a one-column CSV without a header reads as lines, unquoted, without its trailing commas', () => {
    expect(parseImport('"Goat, on a Bike",,\r\nOwl,\r\n').rows.map((r) => r.text)).toEqual(['Goat, on a Bike', 'Owl'])
  })

  it('a quoted cell running over two lines stays one prompt', () => {
    expect(parseImport('text\n"Goat on\na Bike"\nOwl at Noon').rows.map((r) => [r.line, r.text])).toEqual([
      [2, 'Goat on\na Bike'],
      [4, 'Owl at Noon'],
    ])
  })
})

describe('what importing would do', () => {
  it('marks new, duplicate (pool and within the file), too long and invalid', () => {
    const rows = preview(
      [
        'Goat on a Bike', // new
        'goat   ON a bike', // same as line 1
        'Owl at the Dentist', // in the pool
        'A Very Long Prompt That Goes On', // 7 words
        'Sloth.', // full stop
        'ab', // too short
      ].join('\n'),
      [prompt('Owl at the Dentist', 'Ben')],
    )
    expect(statuses(rows)).toEqual(['new', 'duplicate', 'duplicate', 'too_long', 'invalid', 'invalid'])
    expect(rows[1]?.reason).toBe('Same as line 1')
    expect(rows[2]?.reason).toContain('Ben wrote it')
    expect(rows[3]?.reason).toBe('7 words, 31 characters — Guess allows 5 words, 32 characters')
    expect(summarize(rows)).toBe('1 new · 2 duplicates · 1 too long · 2 invalid')
  })

  it('mode defaults to guess; gallery allows 120; both takes the guess rule; unknown modes are invalid', () => {
    const long = 'A Very Long Prompt That Goes On'
    const rows = preview(`text,mode\n${long},\n${long} 2,gallery\n${long} 3,both\nOwl,party`)
    expect(rows.map((r) => [r.mode, r.status])).toEqual([
      ['guess', 'too_long'],
      ['gallery', 'new'],
      ['both', 'too_long'],
      ['guess', 'invalid'],
    ])
  })

  it('attribution: the importer by default, an author column per row, "import all as" over both', () => {
    const csv = 'text,author\nGoat on a Bike,Ben\nOwl at Noon,'
    expect(preview(csv).map((r) => r.author)).toEqual(['Ben', 'Karolis'])
    expect(preview(csv, [], { me: 'Karolis', importAllAs: ' generated ' }).map((r) => r.author)).toEqual([
      'generated',
      'generated',
    ])
  })

  it('an export imported back adds nothing — every row is a duplicate, archived ones included', () => {
    const pool = [
      prompt('Goat, on a "Bike"', 'Ben', { votes: { ana: 1 } }),
      prompt('A Much Longer Gallery Prompt About Many Things', 'Ana', { mode: 'gallery', archived: true }),
      prompt('Karolis’ Owl', 'Karolis', { mode: 'both', buildCount: 3 }),
    ]
    const rows = preview(promptsAsCsv(pool), pool)
    expect(rows).toHaveLength(3)
    expect(statuses(rows)).toEqual(['duplicate', 'duplicate', 'duplicate'])
    expect(summarize(rows)).toBe('0 new · 3 duplicates')
  })
})
