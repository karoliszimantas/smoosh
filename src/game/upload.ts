import type { GameServices } from './services'
import { getSessionId } from './session'

export const UPLOAD_ATTEMPTS = 3
// smaller versions tried after a 413, on top of the attempts
export const SHRINK_STEPS = 3
// the whole send, retries included: past this the player is told and can
// try again, rather than watching "Sending…" while the round moves on
export const UPLOAD_BUDGET_MS = 12_000

// Everything a player can be told about sending a picture. Fixed words,
// never the server's own text or a status code.
export const PICTURE_MESSAGES = {
  tooLate: "Didn't make it in time — the pictures were already showing. Your work is saved.",
  generic: 'Something went wrong sending your picture',
} as const

export type UploadResult = { ok: true } | { ok: false; message: string; final: boolean }

// a smaller encoding of the same picture, step 1 the mildest — null when
// there is nothing smaller to make
export type Shrink = (blob: Blob, step: number) => Promise<Blob | null>

// 409: the round already moved on — final, nothing to retry. 413: too big —
// re-encoded smaller and sent again, without a word to the player. Network
// errors and 5xx are retried. Anything else, or running out of attempts or
// time, is the generic failure with Try again.
export async function uploadPicture(
  send: GameServices['upload'],
  url: string,
  blob: Blob,
  shrink?: Shrink,
): Promise<UploadResult> {
  const failed: UploadResult = { ok: false, message: PICTURE_MESSAGES.generic, final: false }
  const deadline = Date.now() + UPLOAD_BUDGET_MS
  let body = blob
  let attempt = 0
  let step = 0
  while (attempt < UPLOAD_ATTEMPTS) {
    const left = deadline - Date.now()
    if (left <= 0) return failed
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    // the send is abandoned at the deadline even if it ignores the abort
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort()
        reject(new Error('upload timed out'))
      }, left)
    })
    try {
      const res = await Promise.race([
        send(url, {
          method: 'POST',
          headers: { 'Content-Type': 'image/webp', 'X-Session-Id': getSessionId() },
          body,
          signal: abort.signal,
        }),
        timedOut,
      ])
      if (res.ok) return { ok: true }
      if (res.status === 409) return { ok: false, message: PICTURE_MESSAGES.tooLate, final: true }
      if (res.status === 413) {
        const smaller = shrink && step < SHRINK_STEPS ? await shrink(blob, ++step).catch(() => null) : null
        if (!smaller) return failed
        body = smaller
        continue
      }
      if (res.status < 500) return failed
    } catch (err: unknown) {
      console.error('submission upload failed', err)
    } finally {
      clearTimeout(timer)
    }
    attempt++
    if (attempt < UPLOAD_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 800 * attempt))
  }
  return failed
}
