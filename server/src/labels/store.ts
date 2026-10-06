// The asset labels file (tools/asset-labels.tsv), live. The copy here — in
// the private bucket, beside the prompt pool — is the one the /labels tool
// edits; the laptop pulls it into the repo and pushes hand edits back
// (tools/labelsSync.ts), each push refused if this copy moved on since that
// laptop's last pull. One file, one writer at a time, nothing diverges
// quietly.

import { createHash } from 'node:crypto'
import { parseLabels, rowProblems, serializeLabels, type LabelRow, type LabelsDoc } from '@smoosh/protocol'
import { PromptError, type PoolBackend } from '../prompts/store.ts'

export type LabelPatch = { label: string; tags: string[]; remove: boolean; note: string }

// the version a laptop pulled — "empty" before the first push
export function versionOf(text: string | null): string {
  return text === null ? 'empty' : createHash('sha256').update(text).digest('hex').slice(0, 16)
}

export class LabelStore {
  private doc: LabelsDoc | null = null
  private text: string | null = null
  private ready: Promise<void> | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly backend: PoolBackend,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // Loads once; a failed load is retried on next use, never taken as empty
  // (that would let a write replace the real file).
  private ensureLoaded(): Promise<void> {
    if (!this.ready) {
      this.ready = this.backend.load().then((text) => {
        if (text === null) return
        const { doc, problems } = parseLabels(text)
        if (problems.length > 0) throw new Error(`stored labels don't read: ${problems[0] ?? ''}`)
        this.doc = doc
        this.text = text
      })
      this.ready.catch((err: unknown) => {
        console.error(`[labels] load from ${this.backend.name} failed:`, err)
        this.ready = null
      })
    }
    return this.ready.catch(() => {
      throw new PromptError(503, 'unavailable', "The labels can't be reached right now. Try again in a minute.")
    })
  }

  async snapshot(): Promise<{ rows: LabelRow[]; version: string }> {
    await this.ensureLoaded()
    return { rows: this.doc?.rows ?? [], version: versionOf(this.text) }
  }

  async file(): Promise<{ text: string | null; version: string }> {
    await this.ensureLoaded()
    return { text: this.text, version: versionOf(this.text) }
  }

  // one change at a time, against the latest file, saved before the next
  private mutate<T>(change: (doc: LabelsDoc | null, text: string | null) => { doc: LabelsDoc; result: T }): Promise<T> {
    const run = this.queue.then(async () => {
      await this.ensureLoaded()
      const { doc, result } = change(this.doc === null ? null : structuredClone(this.doc), this.text)
      const text = serializeLabels(doc)
      await this.backend.save(text)
      this.doc = doc
      this.text = text
      return result
    })
    this.queue = run.catch(() => {})
    return run
  }

  // A row as edited in the tool — created if the asset has none yet.
  // `seen` is the row's edited_at as the editor last saw it: a different
  // one now means someone else saved it in between, and they're asked to
  // look again rather than overwritten.
  editRow(id: string, category: string, patch: LabelPatch, author: string, seen: string | null): Promise<LabelRow> {
    return this.mutate((doc) => {
      if (!doc) {
        throw new PromptError(409, 'not_seeded', 'The labels haven’t been uploaded yet — run pnpm labels:push on the laptop first.')
      }
      const existing = doc.rows.find((r) => r.id === id)
      if (existing && seen !== null && existing.editedAt !== seen) {
        throw new PromptError(
          409,
          'changed',
          `${existing.editedBy || 'Someone'} changed this a moment ago — have a look at their version, then save again.`,
        )
      }
      // checked as typed — a tab is refused, not quietly turned into a space
      const asTyped = rowProblems({ id, category, label: patch.label, tags: patch.tags, note: patch.note })
      if (asTyped.length > 0) throw new PromptError(400, 'invalid', asTyped.join(' '))
      const row: LabelRow = {
        id,
        category,
        label: patch.label.trim().replace(/\s+/g, ' '),
        tags: [...new Set(patch.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))],
        remove: patch.remove,
        note: patch.note.trim(),
        editedBy: author,
        editedAt: this.now().toISOString(),
      }
      const problems = rowProblems(row)
      if (!row.label && !row.remove) problems.push('It needs a label.')
      if (problems.length > 0) throw new PromptError(400, 'invalid', problems.join(' '))
      if (existing) doc.rows[doc.rows.indexOf(existing)] = row
      else doc.rows.push(row)
      return { doc, result: row }
    })
  }

  // The laptop's push: the whole file, as edited there. Refused if this
  // copy changed since that laptop's pull (`base`), or if it doesn't read.
  // Saved in the standard layout ("pug,dog" becomes "pug, dog"), which is
  // handed back so the laptop's copy matches it exactly.
  replaceFile(text: string, base: string): Promise<{ text: string; version: string }> {
    return this.mutate((_doc, current) => {
      if (base !== versionOf(current)) {
        throw new PromptError(
          409,
          'behind',
          'The live labels changed since your last pull — pull first (your edits stay in the file), then push again.',
        )
      }
      const { doc, problems } = parseLabels(text)
      if (problems.length > 0) throw new PromptError(400, 'invalid', problems.slice(0, 10).join(' '))
      const saved = serializeLabels(doc)
      return { doc, result: { text: saved, version: versionOf(saved) } }
    })
  }
}
