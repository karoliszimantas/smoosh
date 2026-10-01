// messages between cutClient.ts (main thread) and cut.worker.ts

export type WorkerRequest = { job: number; url: string }

export type WorkerResponse =
  | { type: 'progress'; job: number; key: string; loaded: number; total: number }
  | { type: 'cutting'; job: number }
  | { type: 'done'; job: number; place: Blob; upload: Blob | null }
  | { type: 'error'; job: number; message: string; fatal: boolean }
