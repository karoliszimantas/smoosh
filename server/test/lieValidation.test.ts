import { describe, it, expect } from 'vitest'
import { normalizeGuessText, validateLie } from '../src/game/lieValidation.ts'

describe('normalizeGuessText', () => {
  it('collapses case, leading/trailing, and internal repeated whitespace identically', () => {
    expect(normalizeGuessText('  Vampire   Bunny   Hotel Reception  ')).toBe('vampire bunny hotel reception')
    expect(normalizeGuessText('vampire bunny hotel reception')).toBe('vampire bunny hotel reception')
  })
})

describe('validateLie', () => {
  const truth = 'Vampire Bunny Hotel Reception'

  it('rejects a lie equal to the truth verbatim', () => {
    expect(validateLie(truth, truth, [])).toBe('matches_truth')
  })

  it('rejects a lie equal to the truth only after normalization', () => {
    expect(validateLie('  Vampire   Bunny Hotel Reception ', truth, [])).toBe('matches_truth')
  })

  it('rejects a lie duplicating another already-accepted lie under the same normalization', () => {
    expect(validateLie('Grumpy Cat Diner', truth, ['  grumpy   cat diner  '])).toBe('duplicate_lie')
  })

  it('accepts a lie sharing words with the truth but not equal after normalization', () => {
    expect(validateLie('Vampire Bunny Book Club', truth, [])).toBeNull()
  })

  it('accepts the first lie submitted when no others exist yet', () => {
    expect(validateLie('Grumpy Cat Diner', truth, [])).toBeNull()
  })

  it('rejects the second identical submission but not the first (order matters)', () => {
    const existing: string[] = []
    const first = validateLie('Grumpy Cat Diner', truth, existing)
    expect(first).toBeNull()
    existing.push('Grumpy Cat Diner')
    const second = validateLie('grumpy cat diner', truth, existing)
    expect(second).toBe('duplicate_lie')
  })
})
