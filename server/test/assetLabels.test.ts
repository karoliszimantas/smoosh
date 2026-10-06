import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseLabels, serializeLabels } from '@smoosh/protocol'

const REAL = readFileSync(new URL('../../tools/asset-labels.tsv', import.meta.url), 'utf8')

describe('asset-labels.tsv', () => {
  it('the real file reads without a problem and writes back byte for byte', () => {
    const { doc, problems } = parseLabels(REAL)
    expect(problems).toEqual([])
    expect(doc.rows.length).toBe(552)
    expect(serializeLabels(doc)).toBe(REAL)
  })

  it('a row edited in the tool looks exactly like one typed by hand', () => {
    const { doc } = parseLabels(REAL)
    const row = doc.rows[0]
    if (!row) throw new Error('no rows')
    row.label = 'Easter Chicks'
    row.tags = ['chick', 'easter']
    const byTool = serializeLabels(doc)
    const byHand = REAL.replace(
      'animals-adorable-15904\tanimals\tToy Chicks\tchick, chicks, baby bird, bird, yellow, easter, toy, fluffy\t\t',
      'animals-adorable-15904\tanimals\tEaster Chicks\tchick, easter\t\t',
    )
    expect(byTool).toBe(byHand)
  })

  it('attribution adds two columns at the end, and the result still reads', () => {
    const { doc } = parseLabels(REAL)
    const row = doc.rows[1]
    if (!row) throw new Error('no rows')
    row.editedBy = 'Ana'
    row.editedAt = '2026-10-06T10:00:00.000Z'
    const text = serializeLabels(doc)
    expect(text).toContain('id\tcategory\tlabel\ttags\tremove\tnote\tedited_by\tedited_at')
    const again = parseLabels(text)
    expect(again.problems).toEqual([])
    expect(again.doc.rows[1]?.editedBy).toBe('Ana')
    expect(serializeLabels(again.doc)).toBe(text)
  })

  it('says plainly what is wrong', () => {
    const bad = REAL.replace('\tToy Chicks\t', '\tToy\tChicks\t')
      .replace('farm animal, head\t', 'farm animal, head,\t')
    const { problems } = parseLabels(bad)
    expect(problems.some((p) => /tab inside a cell/.test(p))).toBe(true)
    expect(problems.some((p) => /stray or trailing comma/.test(p))).toBe(true)
  })
})
