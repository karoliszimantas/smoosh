import type { Shrink } from './upload'

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
}

// A finished picture as WebP, where the browser writes it. Safari asks for
// WebP and quietly hands back PNG — not the type asked for, and often over
// the size limit — so an opaque picture goes out as JPEG instead. One that
// needs its transparency (a chain pass) stays PNG, the only other format
// every browser writes with alpha.
export async function encodePicture(
  canvas: HTMLCanvasElement,
  transparent: boolean,
  quality: number,
  jpegQuality = quality,
): Promise<Blob | null> {
  const webp = await toBlob(canvas, 'image/webp', quality)
  if (!webp || webp.type === 'image/webp' || transparent) return webp
  return toBlob(canvas, 'image/jpeg', jpegQuality)
}

// Smaller versions of a finished picture, for when it's refused as too big.
// WebP and JPEG step the quality down; PNG has no quality (a transparent
// picture where WebP isn't written), so it's scaled down instead.
const QUALITY = [0.6, 0.45, 0.3]
const SCALE = [0.85, 0.7, 0.55]

function encode(source: ImageBitmap, scale: number, quality: number, transparent: boolean): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(source.width * scale))
  canvas.height = Math.max(1, Math.round(source.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return encodePicture(canvas, transparent, quality).finally(() => {
    // let the pixels go now rather than whenever the collector gets to them
    canvas.width = 0
    canvas.height = 0
  })
}

// `transparent`: the picture must keep its alpha — a chain pass
export function shrinkPicture(transparent: boolean): Shrink {
  return async (blob, step) => {
    const quality = QUALITY[step - 1]
    const scale = SCALE[step - 1]
    if (quality === undefined || scale === undefined) return null
    const bitmap = await createImageBitmap(blob)
    try {
      const out = await encode(bitmap, 1, quality, transparent)
      if (out && out.type !== 'image/png') return out
      return await encode(bitmap, scale, quality, transparent)
    } finally {
      bitmap.close()
    }
  }
}
