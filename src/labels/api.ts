import type { LabelRow } from '@smoosh/protocol'
import { getCode, getName } from '../prompts/access'
import { SERVER_URL } from '../game/serverUrl'

// /api/labels, with the same shared code and name as the prompt list

export class LabelsApiError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'LabelsApiError'
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${SERVER_URL}/api/labels${path}`, {
      method,
      headers: {
        'x-prompt-code': getCode(),
        'x-prompt-author': encodeURIComponent(getName()),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new LabelsApiError('offline', "Can't connect. Check your connection and try again.")
  }
  const data = (await res.json().catch(() => ({}))) as { error?: unknown; message?: unknown }
  if (!res.ok) {
    throw new LabelsApiError(
      typeof data.error === 'string' ? data.error : 'error',
      typeof data.message === 'string' ? data.message : 'Something went wrong. Try again.',
    )
  }
  return data as T
}

export type LabelEdit = { category: string; label: string; tags: string[]; remove: boolean; note: string; seen: string | null }

export const labelsApi = {
  list: () => call<{ rows: LabelRow[]; version: string }>('GET', ''),
  save: (id: string, edit: LabelEdit) => call<{ row: LabelRow }>('PATCH', `/rows/${encodeURIComponent(id)}`, edit),
}
