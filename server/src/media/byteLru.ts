// Size-bounded LRU for image bytes. Map iteration order is insertion order,
// so re-inserting on read moves an entry to the "most recent" end and the
// first key is always the least recently used.
export class ByteLru<V extends { bytes: Buffer }> {
  private readonly entries = new Map<string, V>()
  private totalBytes = 0

  constructor(private readonly maxBytes: number) {}

  get(key: string): V | undefined {
    const value = this.entries.get(key)
    if (!value) return undefined
    this.entries.delete(key)
    this.entries.set(key, value)
    return value
  }

  set(key: string, value: V): void {
    if (value.bytes.length > this.maxBytes) return
    this.delete(key)
    this.entries.set(key, value)
    this.totalBytes += value.bytes.length
    while (this.totalBytes > this.maxBytes) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.delete(oldest.value)
    }
  }

  delete(key: string): void {
    const existing = this.entries.get(key)
    if (!existing) return
    this.entries.delete(key)
    this.totalBytes -= existing.bytes.length
  }

  get size(): number {
    return this.totalBytes
  }
}
