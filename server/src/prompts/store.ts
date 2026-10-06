// The shared prompt pool: one JSON object, held in memory, written back
// whole after every change. No database — at three writers and a couple of
// thousand prompts, that is the correct and simple choice.

import { z } from 'zod'
import {
  GALLERY_MAX_CHARS,
  MAX_PROMPT_AUTHOR_LENGTH,
  PROMPT_MIN_CHARS,
  PROMPT_MODES,
  normalizePromptText,
  promptKey,
  promptProblem,
  type PromptMode,
} from '@smoosh/protocol'

export { PROMPT_MODES, type PromptMode }

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
export const MAX_AUTHOR_LENGTH = MAX_PROMPT_AUTHOR_LENGTH

export const normalizeText = normalizePromptText

// the outer bounds for any mode; the mode's own limits are checked with it
// (checkText), since an edit may change either
export const PromptTextSchema = z
  .string()
  .transform(normalizeText)
  .pipe(
    z
      .string()
      .min(PROMPT_MIN_CHARS, `A prompt needs at least ${PROMPT_MIN_CHARS} characters`)
      .max(GALLERY_MAX_CHARS, `Keep it under ${GALLERY_MAX_CHARS} characters`),
  )

function checkText(text: string, mode: PromptMode): void {
  const problem = promptProblem(text, mode)
  if (problem) throw new PromptError(400, 'invalid', `${problem.message}.`)
}

// one row of an import, as the server received it — checked again here,
// whatever the page's preview said
export type ImportRow = { text: string; mode: PromptMode; author: string }
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

const quoted = (text: string) => `“${text.length > 40 ? `${text.slice(0, 40)}…` : text}”`

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
    const key = promptKey(text)
    const clash = pool.find((p) => p.id !== exceptId && promptKey(p.text) === key)
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
      checkText(text, mode)
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
      // a prompt that predates a rule keeps working until someone edits it
      if (patch.text !== undefined || patch.mode !== undefined) checkText(patch.text ?? p.text, patch.mode ?? p.mode)
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

  // All of them or none: every row is checked against the rules, the pool and
  // the rest of the import before anything is added, and the pool is only
  // replaced once the whole lot is saved. Answers with the new prompts' ids.
  import(rows: readonly ImportRow[]): Promise<string[]> {
    return this.mutate((pool) => {
      if (pool.length + rows.length > MAX_PROMPTS) {
        throw new PromptError(
          409,
          'full',
          `That would take the list past ${MAX_PROMPTS} — there's room for ${Math.max(0, MAX_PROMPTS - pool.length)} more.`,
        )
      }
      const seen = new Map(pool.map((p) => [promptKey(p.text), p]))
      const added: string[] = []
      rows.forEach((row, i) => {
        const at = `Row ${i + 1}, ${quoted(row.text)}`
        const problem = promptProblem(row.text, row.mode)
        if (problem) throw new PromptError(400, 'invalid', `${at}: ${problem.message}. Nothing was imported.`)
        const clash = seen.get(promptKey(row.text))
        if (clash) {
          throw new PromptError(
            409,
            'duplicate',
            `${at} is already in the list — ${clash.author} wrote it. Nothing was imported.`,
          )
        }
        const prompt: StoredPrompt = {
          id: this.newId(),
          text: row.text,
          mode: row.mode,
          author: row.author,
          createdAt: this.now().toISOString(),
          archived: false,
          votes: {},
          buildCount: 0,
        }
        pool.push(prompt)
        seen.set(promptKey(row.text), prompt)
        added.push(prompt.id)
      })
      return added
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
