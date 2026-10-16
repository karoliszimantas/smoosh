import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RoomSnapshot } from '@smoosh/protocol'
import { fixtureSnapshot } from '../dev/fixtures'
import {
  forgetPictureLines,
  pictureLine,
  previousPictureLine,
  recordPictureLine,
  roundPictureLines,
} from './pictureLines'
import LieView from './phases/LieView'
import ScoresView from './phases/ScoresView'

const emit = () => Promise.reject(new Error('not used'))

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function memoryStore() {
  const data = new Map<string, string>()
  return {
    data,
    get length() {
      return data.size
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

// Alice's picture, with who wrote which fake and who picked what. The
// players: Sam (you), Alice, Bob, Cara
function reveal(
  lies: { authorId: string; pickedBy: string[] }[],
  foundBy: string[],
  at: { round?: number; pictureIndex?: number; authorId?: string } = {},
): RoomSnapshot {
  const snap = fixtureSnapshot('reveal', undefined, { authorId: at.authorId ?? 'alice' })
  if (snap.phase.phase !== 'reveal') throw new Error('fixture')
  return {
    ...snap,
    phase: {
      ...snap.phase,
      round: at.round ?? 1,
      pictureIndex: at.pictureIndex ?? 0,
      options: [
        { id: 't', text: 'a cat riding a bicycle', isTruth: true, authorId: null, pickedBy: foundBy },
        ...lies.map((l, i) => ({ id: `l${i}`, text: `fake ${i}`, isTruth: false, authorId: l.authorId, pickedBy: l.pickedBy })),
      ],
      realOptionId: 't',
      pointsThisPicture: [],
    },
  }
}

describe('a picture in one line', () => {
  it('who fooled whom, then who found it', () => {
    expect(pictureLine(reveal([{ authorId: 'bob', pickedBy: ['cara'] }], ['you']))).toBe('Bob fooled Cara · you found it')
    expect(pictureLine(reveal([{ authorId: 'bob', pickedBy: ['cara', 'you'] }], []))).toBe('Bob fooled Cara and you · nobody found it')
  })

  it('several fakes that worked, the best fib first', () => {
    const line = pictureLine(
      reveal(
        [
          { authorId: 'cara', pickedBy: ['bob'] },
          { authorId: 'bob', pickedBy: ['cara', 'you'] },
        ],
        [],
      ),
    )
    expect(line).toBe('Bob fooled Cara and you · Cara fooled Bob · nobody found it')
  })

  it('nobody fooled: only who found it', () => {
    expect(pictureLine(reveal([{ authorId: 'bob', pickedBy: [] }], ['bob', 'cara', 'you']))).toBe(
      'Bob, Cara and you found it',
    )
  })

  it('nobody fooled and nobody found it', () => {
    expect(pictureLine(reveal([{ authorId: 'bob', pickedBy: [] }], []))).toBe('Nobody found it')
  })

  it('you, at the start, are You', () => {
    expect(pictureLine(reveal([{ authorId: 'you', pickedBy: ['bob'] }], ['cara']))).toBe('You fooled Bob · Cara found it')
  })

  it('no fakes at all', () => {
    expect(pictureLine(reveal([], []))).toBe('Nobody wrote a fake')
  })

  it('nothing outside a reveal', () => {
    expect(pictureLine(fixtureSnapshot('lie'))).toBeNull()
  })
})

describe('the lines kept for later', () => {
  beforeEach(forgetPictureLines)

  it('are kept per round in picture order, one per picture', () => {
    const store = memoryStore()
    recordPictureLine(reveal([{ authorId: 'bob', pickedBy: ['cara'] }], [], { pictureIndex: 1 }), store)
    recordPictureLine(reveal([], [], { pictureIndex: 0, authorId: 'bob' }), store)
    recordPictureLine(reveal([{ authorId: 'bob', pickedBy: ['cara'] }], [], { pictureIndex: 1 }), store)
    const lines = roundPictureLines('TEST', 1, store)
    expect(lines.map((l) => [l.pictureIndex, l.authorName, l.line])).toEqual([
      [0, 'Bob', 'Nobody wrote a fake'],
      [1, 'Alice', 'Bob fooled Cara · nobody found it'],
    ])
    expect(previousPictureLine('TEST', 1, 2, store)?.pictureIndex).toBe(1)
    expect(previousPictureLine('TEST', 1, 0, store)).toBeNull()
  })

  it('a new round clears the old one, so storage never grows', () => {
    const store = memoryStore()
    recordPictureLine(reveal([], [], { round: 1 }), store)
    recordPictureLine(reveal([], [], { round: 2 }), store)
    expect([...store.data.keys()]).toEqual(['smoosh_lines_TEST_2'])
    expect(roundPictureLines('TEST', 1, store)).toEqual([])
  })

  it('with storage refusing, this page still remembers them', () => {
    const refusing = {
      length: 0,
      key: () => null,
      getItem: (): string | null => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
    }
    recordPictureLine(reveal([], [], { pictureIndex: 0 }), refusing)
    expect(roundPictureLines('TEST', 1, refusing).map((l) => l.line)).toEqual(['Nobody wrote a fake'])
  })
})

describe('where the lines show', () => {
  beforeEach(() => {
    forgetPictureLines()
    vi.stubGlobal('sessionStorage', memoryStore())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('the last picture’s, quietly, over the next Lie screen', () => {
    recordPictureLine(reveal([{ authorId: 'bob', pickedBy: ['cara'] }], ['you'], { pictureIndex: 0 }))
    const html = renderToStaticMarkup(<LieView snapshot={fixtureSnapshot('lie')} emit={emit} />)
    expect(textOf(html)).toContain('Last picture Bob fooled Cara · you found it')
    expect(html).toContain('class="picture-line-last"')
  })

  it('every picture’s on Scores, with whose picture it was', () => {
    recordPictureLine(reveal([{ authorId: 'bob', pickedBy: ['cara'] }], ['you'], { pictureIndex: 0 }))
    recordPictureLine(reveal([], [], { pictureIndex: 1, authorId: 'you' }))
    const text = textOf(renderToStaticMarkup(<ScoresView snapshot={fixtureSnapshot('scores')} emit={emit} />))
    expect(text).toContain('This round Alice’s picture Bob fooled Cara · you found it Your picture Nobody wrote a fake')
  })

  it('no lines seen: no section', () => {
    const html = renderToStaticMarkup(<ScoresView snapshot={fixtureSnapshot('scores')} emit={emit} />)
    expect(html).not.toContain('round-lines')
  })
})
