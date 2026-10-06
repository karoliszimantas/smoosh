import type { Shrink } from './upload'

// Smaller versions of a finished picture, for when it's refused as too big.
// Where the browser writes WebP the quality steps down; where it can't
// (Safari writes PNG, which has no quality) the picture is scaled down
// instead. Transparency is kept — a chain pass needs it.
const QUALITY = [0.6, 0.45, 0.3]
const SCALE = [0.85, 0.7, 0.55]

function encode(source: ImageBitmap, scale: number, quality: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(source.width * scale))
  canvas.height = Math.max(1, Math.round(source.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality)).finally(() => {
    // let the pixels go now rather than whenever the collector gets to them
    canvas.width = 0
    canvas.height = 0
  })
}

export const shrinkPicture: Shrink = async (blob, step) => {
  const quality = QUALITY[step - 1]
  const scale = SCALE[step - 1]
  if (quality === undefined || scale === undefined) return null
  const bitmap = await createImageBitmap(blob)
  try {
    const out = await encode(bitmap, 1, quality)
    if (out?.type === 'image/webp') return out
    return await encode(bitmap, scale, quality)
  } finally {
    bitmap.close()
  }
}
