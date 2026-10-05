import type { GameServices } from './services'
import { getSessionId } from './session'

export const UPLOAD_ATTEMPTS = 3

export type UploadResult = { ok: true } | { ok: false; message: string; final: boolean }

// network errors and 5xx are worth another go; any other refusal (409: the
// round already moved on) is the server's final answer
export async function uploadPicture(send: GameServices['upload'], url: string, blob: Blob): Promise<UploadResult> {
  for (let attempt = 0; attempt < UPLOAD_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 800 * attempt))
    try {
      const res = await send(url, {
        method: 'POST',
        headers: { 'Content-Type': 'image/webp', 'X-Session-Id': getSessionId() },
        body: blob,
      })
      if (res.ok) return { ok: true }
      if (res.status < 500) {
        const text = await res.text().catch(() => '')
        return { ok: false, message: text || `Your picture was refused (${res.status})`, final: true }
      }
    } catch (err: unknown) {
      console.error('submission upload failed', err)
    }
  }
  return { ok: false, message: 'Could not send your picture — check your connection', final: false }
}
