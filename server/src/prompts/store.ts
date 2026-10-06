// The shared prompt pool: one JSON object, held in memory, written back
// whole after every change. No database — at three writers and a couple of
// thousand prompts, that is the correct and simple choice.

import { z } from 'zod'

export const PROMPT_MODES = ['guess', 'gallery', 'both'] as const
export type PromptMode = (typeof PROMPT_MODES)[number]

export type StoredPrompt = {
  id: string
  text: string
  mode: PromptMode
  author: string
  createdAt: string
  archived: boolean
  // keyed by voter (author name, lowercased) — one vote each, changeable
  votes: Record<string, 1 | -1>
  buildCount: number
}

export const MAX_PROMPTS = 2000
export const MAX_AUTHOR_LENGTH = 24

// trimmed, inner whitespace collapsed — what's stored, and what duplicates
// are compared on (case-insensitively)
export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

export const PromptTextSchema = z
  .string()
  .transform(normalizeText)
  .pipe(z.string().min(3, 'A prompt needs at least 3 characters').max(120, 'Keep it under 120 characters'))
export const PromptModeSchema = z.enum(PROMPT_MODES)

const StoredPromptSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  mode: PromptModeSchema,
  author: z.string(),
  createdAt: z.string(),
  archived: z.boolean(),
  votes: z.record(z.string(), z.union([z.literal(1), z.literal(-1)])),
  buildCount: z.number().int().nonnegative(),
})
const PoolSchema = z.object({ version: z.literal(1), prompts: z.array(StoredPromptSchema) })

export function score(p: StoredPrompt): number {
  return Object.values(p.votes).reduce<number>((sum, v) => sum + v, 0)
}

export function voterKey(author: string): string {
  return author.trim().toLowerCase()
}

// A refusal the client can show as-is. `status` is for HTTP; `message` is
// plain language, never a code.
export class PromptError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'PromptError'
  }
}

export interface PoolBackend {
  readonly name: string
  // null when nothing has been stored yet; throws when the store is unreachable
  load(): Promise<string | null>
  save(json: string): Promise<void>
}

export type BulkAction = 'archive' | 'restore' | 'delete'

export class PromptStore {
  private pool: StoredPrompt[] = []
  private loaded = false
  private ready: Promise<void> | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly backend: PoolBackend,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  // Loads once. A failed load is NOT treated as an empty pool — that would
  // let the next write overwrite the real one — it's retried on next use.
  private ensureLoaded(): Promise<void> {
    if (!this.ready) {
      this.ready = this.backend.load().then(
        (json) => {
          if (json !== null) {
            const parsed = PoolSchema.safeParse(JSON.parse(json))
            if (!parsed.success) throw new Error('stored prompt pool is not in the expected shape')
            this.pool = parsed.data.prompts
          }
          this.loaded = true
        },
        (err: unknown) => {
          throw err instanceof Error ? err : new Error(String(err))
        },
      )
      this.ready.catch((err: unknown) => {
        console.error(`[prompts] load from ${this.backend.name} failed:`, err)
        this.ready = null
      })
    }
    return this.ready.catch(() => {
      throw new PromptError(503, 'unavailable', "The prompt list can't be reached right now. Try again in a minute.")
    })
  }

  async list(): Promise<StoredPrompt[]> {
    await this.ensureLoaded()
    return this.pool
  }

  // what a game can draw from right now — live prompts for that mode, or
  // null while the pool isn't loaded (that also starts a load, so a pool
  // that was unreachable is picked up again by a later game)
  playable(mode: 'guess' | 'gallery'): string[] | null {
    if (!this.loaded) {
      this.ensureLoaded().catch(() => {})
      return null
    }
    return this.pool.filter((p) => !p.archived && (p.mode === mode || p.mode === 'both')).map((p) => p.text)
  }

  // Every change runs alone, in arrival order, against the latest pool, and
  // is saved before the next one starts — two people writing at once can't
  // lose each other's work. A change that throws, or fails to save, leaves
  // the pool exactly as it was.
  private mutate<T>(change: (pool: StoredPrompt[]) => T): Promise<T> {
    const run = this.queue.then(async () => {
      await this.ensureLoaded()
      const draft = structuredClone(this.pool)
      const result = change(draft)
      await this.backend.save(JSON.stringify({ version: 1, prompts: draft }))
      this.pool = draft
      return result
    })
    this.queue = run.catch(() => {})
    return run
  }

  private static find(pool: StoredPrompt[], id: string): StoredPrompt {
    const p = pool.find((x) => x.id === id)
    if (!p) throw new PromptError(404, 'not_found', 'That prompt is gone — someone may have deleted it.')
    return p
  }

  private static assertUnique(pool: StoredPrompt[], text: string, exceptId?: string): void {
    const key = text.toLowerCase()
    const clash = pool.find((p) => p.id !== exceptId && p.text.toLowerCase() === key)
    if (clash) {
      throw new PromptError(
        409,
        'duplicate',
        `Already in the list — ${clash.author} wrote it${clash.archived ? ' (archived)' : ''}.`,
      )
    }
  }

  add(text: string, mode: PromptMode, author: string): Promise<StoredPrompt> {
    return this.mutate((pool) => {
      if (pool.length >= MAX_PROMPTS) {
        throw new PromptError(409, 'full', `The list is full (${MAX_PROMPTS}). Delete some archived prompts first.`)
      }
      PromptStore.assertUnique(pool, text)
      const prompt: StoredPrompt = {
        id: this.newId(),
        text,
        mode,
        author,
        createdAt: this.now().toISOString(),
        archived: false,
        votes: {},
        buildCount: 0,
      }
      pool.push(prompt)
      return prompt
    })
  }

  edit(id: string, patch: { text?: string; mode?: PromptMode; archived?: boolean }): Promise<StoredPrompt> {
    return this.mutate((pool) => {
      const p = PromptStore.find(pool, id)
      if (patch.text !== undefined) {
        PromptStore.assertUnique(pool, patch.text, id)
        p.text = patch.text
      }
      if (patch.mode !== undefined) p.mode = patch.mode
      if (patch.archived !== undefined) p.archived = patch.archived
      return p
    })
  }

  // permanent — and only ever for an archived prompt, so losing one always
  // takes two deliberate steps
  remove(id: string): Promise<void> {
    return this.mutate((pool) => {
      const p = PromptStore.find(pool, id)
      if (!p.archived) throw new PromptError(409, 'not_archived', 'Archive it first — only archived prompts can be deleted.')
      pool.splice(pool.indexOf(p), 1)
    })
  }

  built(id: string): Promise<void> {
    return this.mutate((pool) => {
      PromptStore.find(pool, id).buildCount += 1
    })
  }

  // an opinion only — a downvote never archives anything
  vote(id: string, author: string, vote: 1 | -1): Promise<StoredPrompt> {
    return this.mutate((pool) => {
      const p = PromptStore.find(pool, id)
      p.votes[voterKey(author)] = vote
      return p
    })
  }

  // ids that don't exist are skipped, not an error — someone else may have
  // got there first. Delete only touches archived prompts.
  bulk(ids: readonly string[], action: BulkAction): Promise<number> {
    return this.mutate((pool) => {
      const wanted = new Set(ids)
      let changed = 0
      if (action === 'delete') {
        for (let i = pool.length - 1; i >= 0; i--) {
          const p = pool[i]
          if (p && wanted.has(p.id) && p.archived) {
            pool.splice(i, 1)
            changed++
          }
        }
        return changed
      }
      const archived = action === 'archive'
      for (const p of pool) {
        if (wanted.has(p.id) && p.archived !== archived) {
          p.archived = archived
          changed++
        }
      }
      return changed
    })
  }
}
