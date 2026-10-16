import { describe, it, expect } from 'vitest'
import { BLANK_PICTURE_PARAM } from '@smoosh/protocol'
import { nothingInFrame, type Box } from '../components/canvasExport'
import { pictureUploadUrl } from './upload'

const SERVER = 'https://smoosh.test'
const frame: Box = { x: 16, y: 16, width: 358, height: 358 }
const picture = { roomCode: 'ABCD', round: 2, playerId: 'p1' }

// the URL a picture is sent to, from the layers' boxes on screen
const urlFor = (layers: (Box | null)[]) => pictureUploadUrl(SERVER, { ...picture, blank: nothingInFrame(layers, frame) })

describe('a blank picture is flagged on its upload', () => {
  it('nothing on the canvas: sent with ?blank=1', () => {
    expect(BLANK_PICTURE_PARAM).toBe('blank')
    expect(urlFor([])).toBe(`${SERVER}/submissions/ABCD/2/p1?blank=1`)
  })

  it('a layer on the picture: no flag', () => {
    expect(urlFor([{ x: 100, y: 100, width: 80, height: 80 }])).toBe(`${SERVER}/submissions/ABCD/2/p1`)
  })

  it('every layer parked wholly outside the frame: blank', () => {
    const outside = [
      { x: -100, y: 100, width: 116, height: 50 },
      { x: 374, y: 0, width: 40, height: 40 },
      { x: 50, y: 374, width: 40, height: 40 },
      { x: 50, y: -60, width: 40, height: 76 },
    ]
    expect(urlFor(outside)).toBe(`${SERVER}/submissions/ABCD/2/p1?blank=1`)
  })

  it('one layer reaching into the frame, by a pixel: not blank', () => {
    expect(urlFor([{ x: -100, y: 100, width: 117, height: 50 }, { x: 374, y: 0, width: 40, height: 40 }])).toBe(
      `${SERVER}/submissions/ABCD/2/p1`,
    )
  })

  it('a layer not drawn yet counts as something', () => {
    expect(urlFor([null])).toBe(`${SERVER}/submissions/ABCD/2/p1`)
  })
})
