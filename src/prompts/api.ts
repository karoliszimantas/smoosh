import { adminCall } from '../admin/api'

export type PromptMode = 'guess' | 'gallery' | 'both'
export const PROMPT_MODES: readonly PromptMode[] = ['both', 'guess', 'gallery']

export type Prompt = {
  id: string
  text: string
  mode: PromptMode
  author: string
  createdAt: string
  archived: boolean
  votes: Record<string, 1 | -1>
  buildCount: number
}

export function score(p: Prompt): number {
  return Object.values(p.votes).reduce<number>((sum, v) => sum + v, 0)
}

// matches the server's key for "one vote per person"
export function voterKey(name: string): string {
  return name.trim().toLowerCase()
}

// /api/admin/prompts — every change answers with the whole pool
async function pool(method: string, path: string, body?: unknown): Promise<Prompt[]> {
  return (await adminCall<{ prompts: Prompt[] }>(method, `/prompts${path}`, body)).prompts
}

export const promptApi = {
  list: () => pool('GET', ''),
  add: (text: string, mode: PromptMode) => pool('POST', '', { text, mode }),
  edit: (id: string, patch: { text?: string; mode?: PromptMode; archived?: boolean }) =>
    pool('PATCH', `/${encodeURIComponent(id)}`, patch),
  remove: (id: string) => pool('DELETE', `/${encodeURIComponent(id)}`),
  vote: (id: string, vote: 1 | -1) => pool('POST', `/${encodeURIComponent(id)}/vote`, { vote }),
  bulk: (ids: string[], action: 'archive' | 'restore' | 'delete') => pool('POST', '/bulk', { ids, action }),
  // one request for the lot — the server adds all of them or none
  import: (rows: { text: string; mode: PromptMode; author: string }[]) =>
    adminCall<{ prompts: Prompt[]; added: string[] }>('POST', '/prompts/import', { rows }),
  // fire and forget — a lost count never matters more than the UI
  built: (id: string) => {
    void adminCall<void>('POST', `/prompts/${encodeURIComponent(id)}/built`).catch(() => {})
  },
}
