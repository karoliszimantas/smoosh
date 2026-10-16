import { describe, it, expect } from 'vitest'
import { eccCodewords, encodeText, numDataCodewords, type QrCode } from './qrCode'

const rows = (qr: QrCode) => qr.modules.map((r) => r.map((d) => (d ? '#' : '.')).join(''))

// the 15 format bits, read back from both copies (ISO 18004 §7.9)
function formatBits(qr: QrCode): [number, number] {
  const m = qr.modules
  const n = qr.size
  const bit = (x: number, y: number) => (m[y]?.[x] ? 1 : 0)
  let a = 0
  let b = 0
  const first: [number, number][] = [
    ...[0, 1, 2, 3, 4, 5, 7, 8].map((y): [number, number] => [8, y]),
    [7, 8],
    ...[5, 4, 3, 2, 1, 0].map((x): [number, number] => [x, 8]),
  ]
  const second: [number, number][] = [
    ...Array.from({ length: 8 }, (_, i): [number, number] => [n - 1 - i, 8]),
    ...Array.from({ length: 7 }, (_, i): [number, number] => [8, n - 7 + i]),
  ]
  first.forEach(([x, y], i) => (a |= bit(x, y) << i))
  second.forEach(([x, y], i) => (b |= bit(x, y) << i))
  return [a, b]
}

function bchValid(format: number): boolean {
  let rem = format ^ 0x5412
  for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10)
  return rem === 0
}

describe('the QR encoder', () => {
  it('fits an invite link in a small, sturdy code', () => {
    const qr = encodeText('https://smoosh.example.com/?join=KRPT')
    expect(qr.version).toBe(3)
    expect(qr.size).toBe(29)
    expect(qr.ecc).toBe('M')
    expect(qr.modules).toHaveLength(29)
    for (const row of qr.modules) expect(row).toHaveLength(29)
  })

  it('grows a version for a longer link, and raises the error correction when it fits for free', () => {
    // 12 bytes in version 1: room for M's correction, not Q's
    expect(encodeText('https://a.b/', 'L')).toMatchObject({ version: 1, ecc: 'M' })
    const long = encodeText(`https://example.com/?q=${'x'.repeat(300)}`)
    expect(long.version).toBe(13)
    expect(long.size).toBe(69)
  })

  it('draws the three finders and the timing lines', () => {
    const qr = encodeText('http://192.168.1.20:5173/?join=BCDF')
    const r = rows(qr)
    const n = qr.size
    const finder = ['#######', '#.....#', '#.###.#', '#.###.#', '#.###.#', '#.....#', '#######']
    for (let i = 0; i < 7; i++) {
      expect(r[i]?.slice(0, 7)).toBe(finder[i])
      expect(r[i]?.slice(n - 7)).toBe(finder[i])
      expect(r[n - 7 + i]?.slice(0, 7)).toBe(finder[i])
    }
    // the light separators round them
    expect(r[7]?.slice(0, 8)).toBe('........')
    for (let i = 8; i < n - 8; i++) {
      expect(qr.modules[6]?.[i]).toBe(i % 2 === 0)
      expect(qr.modules[i]?.[6]).toBe(i % 2 === 0)
    }
    // the dark module
    expect(qr.modules[n - 8]?.[8]).toBe(true)
  })

  it('writes the same valid format information twice, naming its level and mask', () => {
    for (const ecc of ['L', 'M', 'Q', 'H'] as const) {
      const qr = encodeText('https://smoosh.example.com/?join=KRPT', ecc)
      const [a, b] = formatBits(qr)
      expect(a).toBe(b)
      expect(bchValid(a)).toBe(true)
      const data = (a ^ 0x5412) >>> 10
      expect(data & 7).toBe(qr.mask)
      expect(data >>> 3).toBe({ L: 1, M: 0, Q: 3, H: 2 }[qr.ecc])
    }
  })

  it('computes the error correction of the standard’s examples', () => {
    // ISO 18004 annex I: "01234567", version 1-M
    const iso = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11]
    expect(eccCodewords(iso, 10)).toEqual([0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55])
    // "HELLO WORLD", version 1-M
    const hello = [0x20, 0x5b, 0x0b, 0x78, 0xd1, 0x72, 0xdc, 0x4d, 0x43, 0x40, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11]
    expect(eccCodewords(hello, 10)).toEqual([0xc4, 0x23, 0x27, 0x77, 0xeb, 0xd7, 0xe7, 0xe2, 0x5d, 0x17])
  })

  it('knows the data capacity of each version and level', () => {
    expect(numDataCodewords(1, 'L')).toBe(19)
    expect(numDataCodewords(1, 'H')).toBe(9)
    expect(numDataCodewords(3, 'M')).toBe(44)
    expect(numDataCodewords(10, 'M')).toBe(216)
    expect(numDataCodewords(40, 'L')).toBe(2956)
    expect(numDataCodewords(40, 'H')).toBe(1276)
  })

  it('draws a known code exactly', () => {
    // checked by decoding a render of it with an independent reader (CoreImage)
    expect(rows(encodeText('HELLO WORLD', 'L'))).toEqual([
      '#######.#..#..#######',
      '#.....#..#....#.....#',
      '#.###.#.#..#..#.###.#',
      '#.###.#.#.##..#.###.#',
      '#.###.#..##.#.#.###.#',
      '#.....#.##.#..#.....#',
      '#######.#.#.#.#######',
      '........#.###........',
      '.#.#.####..#####.##.#',
      '..####...#....##...#.',
      '.#..#.##.#.##..#.##.#',
      '#.###..#.####.#.##.##',
      '.#.##.#.#.##.####.#..',
      '........##..#...#.#..',
      '#######.##.#..######.',
      '#.....#.#####..#....#',
      '#.###.#..#..###...##.',
      '#.###.#.#.#....######',
      '#.###.#...#.#.#.#.#.#',
      '#.....#.#.##.#.......',
      '#######...#.#..#.###.',
    ])
  })

  it('encodes text as UTF-8', () => {
    expect(() => encodeText('héllo ✂️')).not.toThrow()
    expect(() => encodeText('x'.repeat(5000))).toThrow(RangeError)
  })
})
