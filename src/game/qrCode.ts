/*
 * QR Code generator library (TypeScript)
 *
 * Copyright (c) Project Nayuki. (MIT License)
 * https://www.nayuki.io/page/qr-code-generator-library
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 * - The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 * - The Software is provided "as is", without warranty of any kind, express or
 *   implied, including but not limited to the warranties of merchantability,
 *   fitness for a particular purpose and noninfringement. In no event shall the
 *   authors or copyright holders be liable for any claim, damages or other
 *   liability, whether in an action of contract, tort or otherwise, arising from,
 *   out of or in connection with the Software or the use or other dealings in the
 *   Software.
 */

// Vendored for the Lobby's invite QR code, so it's drawn on the phone with
// nothing fetched. Trimmed from Project Nayuki's library to what a link
// needs: text in byte mode (UTF-8), any version and error correction level,
// automatic mask. Numeric, alphanumeric, ECI and kanji segments and the
// library's renderers are gone; the encoding itself is unchanged.

export type Ecc = 'L' | 'M' | 'Q' | 'H'

// ordinal (the tables' row) and the two bits the format information carries
const ECC: Record<Ecc, { ordinal: number; formatBits: number }> = {
  L: { ordinal: 0, formatBits: 1 },
  M: { ordinal: 1, formatBits: 0 },
  Q: { ordinal: 2, formatBits: 3 },
  H: { ordinal: 3, formatBits: 2 },
}

export const MIN_VERSION = 1
export const MAX_VERSION = 40

export type QrCode = {
  version: number
  // modules per side, quiet zone not included
  size: number
  ecc: Ecc
  mask: number
  // modules[y][x], true = dark
  modules: boolean[][]
}

// A QR code of `text`, at the lowest version that holds it, the error
// correction raised from `minEcc` as far as that version allows for free
export function encodeText(text: string, minEcc: Ecc = 'M'): QrCode {
  const data = [...new TextEncoder().encode(text)]
  // byte mode: the mode indicator, the length, then the bytes
  const charCountBits = (ver: number) => (ver <= 9 ? 8 : 16)

  let version = MIN_VERSION
  let usedBits: number
  for (;; version++) {
    const ccBits = charCountBits(version)
    usedBits = data.length < 1 << ccBits ? 4 + ccBits + data.length * 8 : Infinity
    if (usedBits <= numDataCodewords(version, minEcc) * 8) break
    if (version >= MAX_VERSION) throw new RangeError('Data too long')
  }
  let ecc = minEcc
  for (const boosted of ['M', 'Q', 'H'] as const) {
    if (ECC[boosted].ordinal > ECC[ecc].ordinal && usedBits <= numDataCodewords(version, boosted) * 8) ecc = boosted
  }

  const bb: number[] = []
  appendBits(0x4, 4, bb)
  appendBits(data.length, charCountBits(version), bb)
  for (const b of data) appendBits(b, 8, bb)

  // terminator, byte alignment, then alternating pad bytes to capacity
  const capacityBits = numDataCodewords(version, ecc) * 8
  appendBits(0, Math.min(4, capacityBits - bb.length), bb)
  appendBits(0, (8 - (bb.length % 8)) % 8, bb)
  for (let pad = 0xec; bb.length < capacityBits; pad ^= 0xec ^ 0x11) appendBits(pad, 8, bb)

  const dataCodewords: number[] = new Array<number>(bb.length / 8).fill(0)
  bb.forEach((bit, i) => (dataCodewords[i >>> 3] = at(dataCodewords, i >>> 3) | (bit << (7 - (i & 7)))))
  return encodeCodewords(version, ecc, dataCodewords)
}

// the light margin every reader needs round a code, in modules
export const QUIET_ZONE = 4

// the code as one SVG path: a unit square for each dark module, offset by
// the quiet zone
export function qrPath(qr: QrCode): string {
  let d = ''
  qr.modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`
    }),
  )
  return d
}

function encodeCodewords(version: number, ecc: Ecc, dataCodewords: number[]): QrCode {
  const size = version * 4 + 17
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const isFunction: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))

  const setFunctionModule = (x: number, y: number, isDark: boolean) => {
    setCell(modules, x, y, isDark)
    setCell(isFunction, x, y, true)
  }

  const drawFormatBits = (mask: number) => {
    const data = (ECC[ecc].formatBits << 3) | mask
    let rem = data
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const bits = ((data << 10) | rem) ^ 0x5412
    // first copy, round the top-left finder
    for (let i = 0; i <= 5; i++) setFunctionModule(8, i, getBit(bits, i))
    setFunctionModule(8, 7, getBit(bits, 6))
    setFunctionModule(8, 8, getBit(bits, 7))
    setFunctionModule(7, 8, getBit(bits, 8))
    for (let i = 9; i < 15; i++) setFunctionModule(14 - i, 8, getBit(bits, i))
    // second copy, split between the other two finders
    for (let i = 0; i < 8; i++) setFunctionModule(size - 1 - i, 8, getBit(bits, i))
    for (let i = 8; i < 15; i++) setFunctionModule(8, size - 15 + i, getBit(bits, i))
    setFunctionModule(8, size - 8, true) // the dark module
  }

  // function patterns: timing, finders, alignment, format and version
  for (let i = 0; i < size; i++) {
    setFunctionModule(6, i, i % 2 === 0)
    setFunctionModule(i, 6, i % 2 === 0)
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy))
        const x = cx + dx
        const y = cy + dy
        if (x >= 0 && x < size && y >= 0 && y < size) setFunctionModule(x, y, dist !== 2 && dist !== 4)
      }
    }
  }
  const alignPos = alignmentPatternPositions(version)
  const numAlign = alignPos.length
  for (let i = 0; i < numAlign; i++) {
    for (let j = 0; j < numAlign; j++) {
      // not over the three finders
      if ((i === 0 && j === 0) || (i === 0 && j === numAlign - 1) || (i === numAlign - 1 && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFunctionModule(at(alignPos, i) + dx, at(alignPos, j) + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
        }
      }
    }
  }
  drawFormatBits(0) // a placeholder, so the codewords flow round it
  if (version >= 7) {
    let rem = version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const bits = (version << 12) | rem
    for (let i = 0; i < 18; i++) {
      const dark = getBit(bits, i)
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      setFunctionModule(a, b, dark)
      setFunctionModule(b, a, dark)
    }
  }

  // the codewords, in the zigzag from the bottom-right corner
  const all = addEccAndInterleave(version, ecc, dataCodewords)
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!cell(isFunction, x, y) && i < all.length * 8) {
          setCell(modules, x, y, getBit(at(all, i >>> 3), 7 - (i & 7)))
          i++
        }
      }
    }
  }

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!cell(isFunction, x, y) && maskInverts(mask, x, y)) setCell(modules, x, y, !cell(modules, x, y))
      }
    }
  }

  // the mask with the lowest penalty
  let mask = 0
  let minPenalty = Infinity
  for (let m = 0; m < 8; m++) {
    applyMask(m)
    drawFormatBits(m)
    const penalty = penaltyScore(modules)
    if (penalty < minPenalty) {
      mask = m
      minPenalty = penalty
    }
    applyMask(m) // XOR again: undone
  }
  applyMask(mask)
  drawFormatBits(mask)

  return { version, size, ecc, mask, modules }
}

function maskInverts(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0
    case 1:
      return y % 2 === 0
    case 2:
      return x % 3 === 0
    case 3:
      return (x + y) % 3 === 0
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  }
}

const PENALTY_N1 = 3
const PENALTY_N2 = 3
const PENALTY_N3 = 40
const PENALTY_N4 = 10

function penaltyScore(modules: boolean[][]): number {
  const size = modules.length
  let result = 0

  const addHistory = (runLength: number, history: number[]) => {
    if (history[0] === 0) runLength += size // the light border before the first run
    history.pop()
    history.unshift(runLength)
  }
  const countPatterns = (history: number[]) => {
    const [h0 = 0, n = 0, h2, h3, h4, h5, h6 = 0] = history
    const core = n > 0 && h2 === n && h3 === n * 3 && h4 === n && h5 === n
    return (core && h0 >= n * 4 && h6 >= n ? 1 : 0) + (core && h6 >= n * 4 && h0 >= n ? 1 : 0)
  }
  const terminateAndCount = (runDark: boolean, runLength: number, history: number[]) => {
    if (runDark) {
      addHistory(runLength, history)
      runLength = 0
    }
    runLength += size
    addHistory(runLength, history)
    return countPatterns(history)
  }

  // runs of one colour, and finder-like patterns, along rows then columns
  for (const along of ['row', 'column'] as const) {
    for (let a = 0; a < size; a++) {
      let runDark = false
      let run = 0
      const history = [0, 0, 0, 0, 0, 0, 0]
      for (let b = 0; b < size; b++) {
        const dark = along === 'row' ? cell(modules, b, a) : cell(modules, a, b)
        if (dark === runDark) {
          run++
          if (run === 5) result += PENALTY_N1
          else if (run > 5) result++
        } else {
          addHistory(run, history)
          if (!runDark) result += countPatterns(history) * PENALTY_N3
          runDark = dark
          run = 1
        }
      }
      result += terminateAndCount(runDark, run, history) * PENALTY_N3
    }
  }

  // 2×2 blocks of one colour
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const dark = cell(modules, x, y)
      if (dark === cell(modules, x + 1, y) && dark === cell(modules, x, y + 1) && dark === cell(modules, x + 1, y + 1)) {
        result += PENALTY_N2
      }
    }
  }

  // dark and light out of balance
  let dark = 0
  for (const row of modules) dark = row.reduce((sum, d) => sum + (d ? 1 : 0), dark)
  const total = size * size
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1
  result += k * PENALTY_N4
  return result
}

function alignmentPatternPositions(version: number): number[] {
  if (version === 1) return []
  const numAlign = Math.floor(version / 7) + 2
  const step = Math.floor((version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2
  const result = [6]
  for (let pos = version * 4 + 17 - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos)
  return result
}

function addEccAndInterleave(version: number, ecc: Ecc, data: number[]): number[] {
  const numBlocks = tableEntry(NUM_ERROR_CORRECTION_BLOCKS, ecc, version)
  const blockEccLen = tableEntry(ECC_CODEWORDS_PER_BLOCK, ecc, version)
  const rawCodewords = Math.floor(numRawDataModules(version) / 8)
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks)
  const shortBlockLen = Math.floor(rawCodewords / numBlocks)

  const blocks: number[][] = []
  const divisor = reedSolomonComputeDivisor(blockEccLen)
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1))
    k += dat.length
    const eccBytes = reedSolomonComputeRemainder(dat, divisor)
    if (i < numShortBlocks) dat.push(0)
    blocks.push(dat.concat(eccBytes))
  }

  const result: number[] = []
  for (let i = 0; i < shortBlockLen + 1; i++) {
    blocks.forEach((block, j) => {
      // skip the short blocks' padding byte
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(at(block, i))
    })
  }
  return result
}

function numRawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2
    result -= (25 * numAlign - 10) * numAlign - 55
    if (version >= 7) result -= 36
  }
  return result
}

export function numDataCodewords(version: number, ecc: Ecc): number {
  return (
    Math.floor(numRawDataModules(version) / 8) -
    tableEntry(ECC_CODEWORDS_PER_BLOCK, ecc, version) * tableEntry(NUM_ERROR_CORRECTION_BLOCKS, ecc, version)
  )
}

function reedSolomonComputeDivisor(degree: number): number[] {
  const result: number[] = new Array<number>(degree - 1).fill(0)
  result.push(1)
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = reedSolomonMultiply(at(result, j), root) ^ (j + 1 < result.length ? at(result, j + 1) : 0)
    }
    root = reedSolomonMultiply(root, 0x02)
  }
  return result
}

// the error correction codewords for one block of data
export function reedSolomonComputeRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ (result.shift() as number)
    result.push(0)
    divisor.forEach((coef, i) => (result[i] = at(result, i) ^ reedSolomonMultiply(coef, factor)))
  }
  return result
}

export function eccCodewords(data: readonly number[], degree: number): number[] {
  return reedSolomonComputeRemainder(data, reedSolomonComputeDivisor(degree))
}

function reedSolomonMultiply(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}

function appendBits(val: number, len: number, bb: number[]): void {
  for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1)
}

// indexing that can't run off the end (lengths are fixed by the version)
function at(a: readonly number[], i: number): number {
  return a[i] ?? 0
}

function cell(grid: readonly (readonly boolean[])[], x: number, y: number): boolean {
  return grid[y]?.[x] ?? false
}

function setCell(grid: boolean[][], x: number, y: number, value: boolean): void {
  const row = grid[y]
  if (row) row[x] = value
}

function tableEntry(table: readonly (readonly number[])[], ecc: Ecc, version: number): number {
  return table[ECC[ecc].ordinal]?.[version] ?? -1
}

function getBit(x: number, i: number): boolean {
  return ((x >>> i) & 1) !== 0
}

// prettier-ignore
const ECC_CODEWORDS_PER_BLOCK: readonly (readonly number[])[] = [
  // Version: (index 0 is padding, set to an illegal value)
  //0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40    Error correction level
  [-1,  7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // Low
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28], // Medium
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // Quartile
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // High
]

// prettier-ignore
const NUM_ERROR_CORRECTION_BLOCKS: readonly (readonly number[])[] = [
  // Version: (index 0 is padding, set to an illegal value)
  //0, 1, 2, 3, 4, 5, 6, 7, 8, 9,10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40    Error correction level
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4,  4,  4,  4,  4,  6,  6,  6,  6,  7,  8,  8,  9,  9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25], // Low
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5,  5,  8,  9,  9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49], // Medium
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8,  8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68], // Quartile
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81], // High
]
