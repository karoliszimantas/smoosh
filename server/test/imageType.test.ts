import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { isPictureType, sniffPictureType } from '../src/submissions/imageType.ts'

const pixels = { create: { width: 4, height: 4, channels: 4 as const, background: { r: 200, g: 40, b: 40, alpha: 0.5 } } }

describe('sniffPictureType', () => {
  it('knows the three picture types by their bytes', async () => {
    expect(sniffPictureType(await sharp(pixels).webp().toBuffer())).toBe('image/webp')
    expect(sniffPictureType(await sharp(pixels).jpeg().toBuffer())).toBe('image/jpeg')
    expect(sniffPictureType(await sharp(pixels).png().toBuffer())).toBe('image/png')
  })

  it('a RIFF that is not WebP is nothing', () => {
    expect(sniffPictureType(Buffer.from('RIFF\0\0\0\0WAVEfmt '))).toBeNull()
  })

  it('refuses garbage, a truncated header and an empty body', () => {
    expect(sniffPictureType(Buffer.from('not a picture at all'))).toBeNull()
    expect(sniffPictureType(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
    expect(sniffPictureType(Buffer.from('RIFF'))).toBeNull()
    expect(sniffPictureType(Buffer.alloc(0))).toBeNull()
  })
})

describe('isPictureType', () => {
  it('takes the three types and nothing else', () => {
    expect(['image/webp', 'image/jpeg', 'image/png'].every((t) => isPictureType(t))).toBe(true)
    expect(isPictureType('image/gif')).toBe(false)
    expect(isPictureType('image/svg+xml')).toBe(false)
    expect(isPictureType(undefined)).toBe(false)
  })
})
