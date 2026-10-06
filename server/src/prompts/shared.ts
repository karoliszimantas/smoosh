import { createPoolBackend } from './backends.ts'
import { PromptStore } from './store.ts'

// The one prompt store: the /prompts page edits it, games draw from it.
let store: PromptStore | null = null
export function getPromptStore(): PromptStore {
  store ??= new PromptStore(createPoolBackend())
  return store
}
// tests swap in a store over an in-memory backend
export function setPromptStoreForTests(s: PromptStore): void {
  store = s
}
