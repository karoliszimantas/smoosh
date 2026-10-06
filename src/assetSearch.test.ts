import { describe, it, expect } from 'vitest'
import { buildIndex, searchAssets } from './assetSearch'
import { promptTabs } from './assets/search'
import type { Asset } from './assets/types'

const asset = (id: string, label: string, tags: string[], category = 'animals'): Asset => ({
  id, category, label, tags, full: `/f/${id}`, thumb: `/t/${id}`, w: 100, h: 100,
})
const index = buildIndex(
  [
    asset('crab', 'Crab', ['crustacean', 'shellfish', 'claw', 'beach']),
    asset('spider', 'Crab Spider', ['spider', 'bug']),
    asset('pug', 'Pug', ['pug', 'dog', 'puppy', 'hound']),
    asset('crate', 'Wooden Crate', ['box', 'crate'], 'props'),
    asset('saw', 'Chainsaw', ['chainsaw', 'saw', 'wood'], 'props'),
    asset('grill', 'Kebab Skewers', ['grill', 'bbq'], 'props'),
    asset('goats', 'Goat Family', ['goats', 'goat', 'kids']),
  ].map((a) => ({ asset: a, categoryLabel: a.category === 'animals' ? 'Animals' : 'Props' })),
)
const ids = (q: string) => searchAssets(index, q).map((a) => a.id)

describe('asset search', () => {
  it('"crab" puts the crab first — the whole label beats a label that contains it', () => {
    expect(ids('crab')[0]).toBe('crab')
    expect(ids('crab')).toContain('spider')
  })

  it('a tag synonym finds the asset', () => {
    expect(ids('crustacean')).toEqual(['crab'])
    expect(ids('puppy')).toEqual(['pug'])
    expect(ids('hound')).toEqual(['pug'])
  })

  it('an exact label outranks a tag match outranks a partial', () => {
    expect(ids('pug')[0]).toBe('pug')
    // "cra…" while typing: label prefixes first
    expect(ids('cra').slice(0, 3).sort()).toEqual(['crab', 'crate', 'spider'].sort())
  })

  it('plurals, -ing and a typo still land', () => {
    expect(ids('crabs')[0]).toBe('crab')
    expect(ids('chainsawing')).toEqual(['saw'])
    expect(ids('grilling')).toEqual(['grill'])
    expect(ids('chainsaww')).toEqual(['saw'])
  })

  it('every word must match somewhere', () => {
    expect(ids('crab dog')).toEqual([])
    expect(ids('goat family')).toEqual(['goats'])
  })

  it('nothing typed, nothing found', () => {
    expect(ids('   ')).toEqual([])
  })
})

describe('prompt tabs', () => {
  it('"Crab performing heart surgery" → Crab · Heart · Surgery', () => {
    expect(promptTabs('Crab performing heart surgery').map((t) => t.label)).toEqual(['Crab', 'Heart', 'Surgery'])
  })

  it('verbs that name nothing go; a verb that names a thing stays', () => {
    expect(promptTabs('Llama Hugging a Cactus').map((t) => t.term)).toEqual(['llama', 'cactus'])
    expect(promptTabs('Pug Chainsawing a Birthday Cake').map((t) => t.term)).toEqual(['pug', 'chainsawing', 'birthday', 'cake'])
  })
})
