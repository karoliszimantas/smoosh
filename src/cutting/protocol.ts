// messages between cutClient.ts (main thread) and cut.worker.ts

// a cut, or just getting the library and its model ready for the first one
export type WorkerRequest = { type: 'cut'; job: number; url: string } | { type: 'preload'; job: number }

// Where the trimmed cut-out sits in the image it was cut from, as fractions
// of that image, and the image's width over its height: enough to put the
// cut-out exactly over the subject of a layer showing the whole image
export type CutTrim = { x: number; y: number; width: number; height: number; aspect: number }

export type WorkerResponse =
  | { type: 'progress'; job: number; key: string; loaded: number; total: number }
  | { type: 'cutting'; job: number }
  // preloaded: the next cut starts straight away
  | { type: 'ready'; job: number }
  | { type: 'done'; job: number; place: Blob; upload: Blob | null; trim: CutTrim }
  | { type: 'error'; job: number; message: string; fatal: boolean }
