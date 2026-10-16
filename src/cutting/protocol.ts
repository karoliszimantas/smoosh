// messages between cutClient.ts (main thread) and cut.worker.ts

export type WorkerRequest = { job: number; url: string }

// Where the trimmed cut-out sits in the image it was cut from, as fractions
// of that image, and the image's width over its height: enough to put the
// cut-out exactly over the subject of a layer showing the whole image
export type CutTrim = { x: number; y: number; width: number; height: number; aspect: number }

export type WorkerResponse =
  | { type: 'progress'; job: number; key: string; loaded: number; total: number }
  | { type: 'cutting'; job: number }
  | { type: 'done'; job: number; place: Blob; upload: Blob | null; trim: CutTrim }
  | { type: 'error'; job: number; message: string; fatal: boolean }
