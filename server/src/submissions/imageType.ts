// The picture types a submission may be: WebP from most browsers, JPEG or
// PNG from Safari, which can't write WebP (PNG only for a chain pass, which
// keeps its transparency).
export const PICTURE_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const
export type PictureType = (typeof PICTURE_TYPES)[number]

export function isPictureType(type: string | undefined): type is PictureType {
  return (PICTURE_TYPES as readonly (string | undefined)[]).includes(type)
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
const RIFF = ascii('RIFF')
const WEBP = ascii('WEBP')
const JPEG_SOI = [0xff, 0xd8, 0xff]
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function hasAt(bytes: Uint8Array, at: number, expected: readonly number[]): boolean {
  if (bytes.length < at + expected.length) return false
  return expected.every((b, i) => bytes[at + i] === b)
}

// What the bytes actually are — the Content-Type header is only the
// sender's word for it. null: none of the three.
export function sniffPictureType(bytes: Uint8Array): PictureType | null {
  if (hasAt(bytes, 0, RIFF) && hasAt(bytes, 8, WEBP)) return 'image/webp'
  if (hasAt(bytes, 0, JPEG_SOI)) return 'image/jpeg'
  if (hasAt(bytes, 0, PNG_SIGNATURE)) return 'image/png'
  return null
}
