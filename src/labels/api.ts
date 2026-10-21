import type { LabelRow } from '@smoosh/protocol'
import { adminCall } from '../admin/api'

// /api/admin/labels

export type LabelEdit = { category: string; label: string; tags: string[]; remove: boolean; note: string; seen: string | null }

export const labelsApi = {
  list: () => adminCall<{ rows: LabelRow[]; version: string }>('GET', '/labels'),
  save: (id: string, edit: LabelEdit) => adminCall<{ row: LabelRow }>('PATCH', `/labels/rows/${encodeURIComponent(id)}`, edit),
}
