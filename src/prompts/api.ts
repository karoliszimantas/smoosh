import { getCode, getName } from './access'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'

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

// `message` is always plain language, safe to show as-is
export class PromptApiError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'PromptApiError'
    this.code = code
  }
}

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${SERVER_URL}/api/prompts${path}`, {
      method,
      headers: {
        'x-prompt-code': getCode(),
        // names can have accents; headers can't — the server decodes this
        'x-prompt-author': encodeURIComponent(getName()),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new PromptApiError('offline', "Can't connect. Check your connection and try again.")
  }
  if (!res.ok) {
    let message = 'Something went wrong. Try again.'
    let code = 'error'
    try {
      const data = (await res.json()) as { error?: unknown; message?: unknown }
      if (typeof data.message === 'string') message = data.message
      if (typeof data.error === 'string') code = data.error
    } catch {
      // not JSON — keep the generic message
    }
    throw new PromptApiError(code, message)
  }
  return res
}

async function pool(method: string, path: string, body?: unknown): Promise<Prompt[]> {
  const res = await call(method, path, body)
  const data = (await res.json()) as { prompts: Prompt[] }
  return data.prompts
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
  import: async (rows: { text: string; mode: PromptMode; author: string }[]) => {
    const res = await call('POST', '/import', { rows })
    return (await res.json()) as { prompts: Prompt[]; added: string[] }
  },
  // fire and forget — a lost count never matters more than the UI
  built: (id: string) => {
    void call('POST', `/${encodeURIComponent(id)}/built`).catch(() => {})
  },
}
