// Players' own photos, kept on this device and nowhere else.
//
// A photo layer's `src` is `photo:<id>` — not a URL. Its pixels (only the
// cut-out, never the whole photo) live in this browser's IndexedDB, so a
// reload mid-build still finds them, and are turned into a blob: URL here
// when a layer needs to draw. Nothing in this file talks to the network:
// a photo reaches anyone else only as pixels inside a finished, flattened
// picture.

const DB_NAME = 'smoosh_photos'
const STORE = 'photos'
const PREFIX = 'photo:'

export function isPhotoSrc(src: string): boolean {
  return src.startsWith(PREFIX)
}

let dbPromise: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('could not open photo storage'))
    })
    dbPromise.catch(() => {
      dbPromise = null
    })
  }
  return dbPromise
}

function request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = run(d.transaction(STORE, mode).objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('photo storage failed'))
      }),
  )
}

// blob: URLs made this page, by src — one per photo, however many layers use it
const urls = new Map<string, string>()

// Keeps the cut. The layer can be placed straight away from the returned
// src; storing is what lets it survive a reload, so a failure here costs
// only that.
export async function savePhoto(blob: Blob): Promise<string> {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  const src = `${PREFIX}${id}`
  urls.set(src, URL.createObjectURL(blob))
  await request('readwrite', (s) => s.put(blob, id)).catch((err: unknown) =>
    console.warn('[photos] not saved — the layer will not survive a reload', err),
  )
  return src
}

// a blob: URL for a photo layer's pixels, or a rejection if they're gone
// (cleared at a game's end, or never saved)
export async function photoUrl(src: string): Promise<string> {
  const known = urls.get(src)
  if (known) return known
  const blob = await request<unknown>('readonly', (s) => s.get(src.slice(PREFIX.length)))
  if (!(blob instanceof Blob)) throw new Error(`photo ${src} is not on this device`)
  const url = URL.createObjectURL(blob)
  urls.set(src, url)
  return url
}

// Every photo a saved canvas still uses — the sandbox's, a game in
// progress. Anything else is a leftover.
function referencedPhotos(): Set<string> {
  const found = new Set<string>()
  for (const area of [localStorage, sessionStorage]) {
    try {
      for (let i = 0; i < area.length; i++) {
        const key = area.key(i)
        if (!key?.startsWith('smoosh_')) continue
        const raw = area.getItem(key) ?? ''
        for (const m of raw.matchAll(/"photo:([a-z0-9]+)"/g)) if (m[1]) found.add(m[1])
      }
    } catch {
      // storage unavailable — keep everything rather than guess
      return new Set(['*'])
    }
  }
  return found
}

// Drops every photo no saved canvas refers to. Called when a game ends or
// is left (its canvases are gone by then) and at startup, which also
// sweeps up after a tab that crashed or was closed mid-game.
export async function prunePhotos(): Promise<void> {
  const keep = referencedPhotos()
  if (keep.has('*')) return
  try {
    const ids = await request<IDBValidKey[]>('readonly', (s) => s.getAllKeys())
    const gone = ids.filter((id): id is string => typeof id === 'string' && !keep.has(id))
    await Promise.all(gone.map((id) => request('readwrite', (s) => s.delete(id))))
    for (const id of gone) {
      const src = `${PREFIX}${id}`
      const url = urls.get(src)
      if (url) URL.revokeObjectURL(url)
      urls.delete(src)
    }
  } catch (err) {
    console.warn('[photos] prune failed', err)
  }
}
