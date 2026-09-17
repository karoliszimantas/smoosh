export type CategoryId = 'animals' | 'props' | 'parts' | 'backgrounds' | 'nature'

export interface CategoryDef {
  id: CategoryId
  label: string
}

export const CATEGORIES: CategoryDef[] = [
  { id: 'animals', label: 'Animals' },
  { id: 'props', label: 'Props' },
  { id: 'parts', label: 'Parts' },
  { id: 'backgrounds', label: 'Backgrounds' },
  { id: 'nature', label: 'Nature' },
]

export const CATEGORY_IDS: CategoryId[] = CATEGORIES.map((c) => c.id)

const CATEGORY_ID_SET: Set<string> = new Set(CATEGORY_IDS)

export function isValidCategory(id: string): id is CategoryId {
  return CATEGORY_ID_SET.has(id)
}
