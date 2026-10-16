import sharp from 'sharp'

// A picture with nothing on it: every pixel the same (the paper colour,
// give or take WebP's noise), or nothing but transparency. Such a picture is
// skipped rather than lied about and guessed.

// how far a channel may wander and still be one flat colour. A lossy WebP
// of a flat page stays well under this; even a small sticker goes over
const FLAT_STDEV = 1.0
// pictures are about 1024px square; anything far bigger isn't one of ours
const MAX_INPUT_PIXELS = 2048 * 2048
// a check that hangs mustn't hold up the upload — it counts as not blank
const CHECK_TIMEOUT_MS = 1500

async function pixelsAreBlank(buffer: Buffer): Promise<boolean> {
  const { channels } = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).stats()
  // grey+alpha or RGB+alpha: the alpha is last
  const hasAlpha = channels.length === 2 || channels.length === 4
  const alpha = hasAlpha ? channels[channels.length - 1] : undefined
  if (alpha && alpha.max === 0) return true
  return channels.every((c) => c.stdev < FLAT_STDEV)
}

// Never fails: a picture that can't be read, or takes too long, is not blank.
export async function looksBlank(buffer: Buffer): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), CHECK_TIMEOUT_MS)
  })
  try {
    return await Promise.race([pixelsAreBlank(buffer), timeout])
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
