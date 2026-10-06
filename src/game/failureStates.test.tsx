import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { UPLOAD_MESSAGES } from '@smoosh/protocol'
import UploadStatus from './UploadStatus'
import NoticeRegion from './NoticeRegion'
import MissingView from './phases/MissingView'
import { PICTURE_MESSAGES, uploadPicture, UPLOAD_ATTEMPTS, UPLOAD_BUDGET_MS } from './upload'
import { actionErrorText } from './roomMessages'
import { fixtureSnapshot, FIXTURE_BASE, YOU_ID } from '../dev/fixtures'

// The screens only the unluckiest player sees — nobody hits them by
// accident, so these keep them from changing unnoticed. They pin the exact
// wording: change the test along with the words.

const noop = () => {}
const emit = () => Promise.reject(new Error('not used'))

// rendered HTML with tags stripped and whitespace collapsed — what a player reads
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function buttonsOf(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => textOf(m[1] ?? ''))
}

describe('upload status over the canvas', () => {
  it('editing: nothing over the canvas', () => {
    expect(renderToStaticMarkup(<UploadStatus state={{ status: 'editing' }} onRetry={noop} />)).toBe('')
  })

  it('sending: says so, offers nothing to press', () => {
    const html = renderToStaticMarkup(<UploadStatus state={{ status: 'sending' }} onRetry={noop} />)
    expect(textOf(html)).toBe('Sending your picture…')
    expect(buttonsOf(html)).toEqual([])
  })

  it('submitted: confirms, only once the server has it', () => {
    const html = renderToStaticMarkup(<UploadStatus state={{ status: 'submitted' }} onRetry={noop} />)
    expect(textOf(html)).toBe('✓ Submitted — waiting for others…')
    expect(buttonsOf(html)).toEqual([])
  })

  it('submitted while others build: names who it is waiting for, marking anyone away', () => {
    const one = renderToStaticMarkup(
      <UploadStatus
        state={{ status: 'submitted' }}
        onRetry={noop}
        waitingFor={[{ id: 'b', name: 'Bob', away: false }]}
      />,
    )
    expect(textOf(one)).toBe('✓ Submitted — waiting for Bob')
    const several = renderToStaticMarkup(
      <UploadStatus
        state={{ status: 'submitted' }}
        onRetry={noop}
        waitingFor={[
          { id: 'b', name: 'Bob', away: true },
          { id: 'c', name: 'Cara', away: false },
          { id: 'd', name: 'Dee', away: false },
        ]}
      />,
    )
    expect(textOf(several)).toBe('✓ Submitted — waiting for Bob away , Cara and Dee')
    expect(several).toContain('Bob<span class="away-marker">away</span>')
  })

  it('every state covers the canvas: the scrim takes the taps', () => {
    for (const status of ['sending', 'submitted', 'refused'] as const) {
      expect(renderToStaticMarkup(<UploadStatus state={{ status }} onRetry={noop} />)).toContain('build-waiting-overlay')
    }
  })

  it('failed: the generic words, and Try again', () => {
    const html = renderToStaticMarkup(
      <UploadStatus state={{ status: 'failed', message: PICTURE_MESSAGES.generic }} onRetry={noop} />,
    )
    expect(html).toContain('role="alert"')
    expect(textOf(html)).toBe('Something went wrong sending your picture Try again')
    expect(buttonsOf(html)).toEqual(['Try again'])
  })

  it('refused for good: covered, but the words are in the notice region, not here', () => {
    const html = renderToStaticMarkup(<UploadStatus state={{ status: 'refused' }} onRetry={noop} />)
    expect(textOf(html)).toBe('')
    expect(buttonsOf(html)).toEqual([])
  })
})

describe('notice region', () => {
  const toast = (id: number, text: string) => ({ id, text, ms: 3000 })

  it('a refusal after the round moved on: the message, and a way to dismiss it', () => {
    const html = renderToStaticMarkup(
      <NoticeRegion alert={PICTURE_MESSAGES.tooLate} onDismissAlert={noop} toasts={[]} onToastDone={noop} />,
    )
    expect(html).toContain('role="alert"')
    expect(textOf(html)).toBe(PICTURE_MESSAGES.tooLate + ' ✕')
    expect(html).toMatch(/<button aria-label="Dismiss">/)
  })

  it('a dropped connection', () => {
    expect(textOf(renderToStaticMarkup(<NoticeRegion reconnecting toasts={[]} onToastDone={noop} />))).toBe('Reconnecting…')
  })

  it('the connection beats a refusal: one message while reconnecting', () => {
    const html = renderToStaticMarkup(
      <NoticeRegion
        reconnecting
        alert={PICTURE_MESSAGES.tooLate}
        onDismissAlert={noop}
        toasts={[toast(1, 'Bob left the game.')]}
        onToastDone={noop}
      />,
    )
    expect(textOf(html)).toBe('Reconnecting…')
  })

  it('each message once: alert first, then news, repeats dropped', () => {
    const html = renderToStaticMarkup(
      <NoticeRegion
        alert={PICTURE_MESSAGES.tooLate}
        onDismissAlert={noop}
        toasts={[toast(1, PICTURE_MESSAGES.tooLate), toast(2, 'Bob left the game.'), toast(3, 'Bob left the game.')]}
        onToastDone={noop}
      />,
    )
    expect(textOf(html)).toBe(`${PICTURE_MESSAGES.tooLate} ✕ Bob left the game.`)
  })

  it('nothing to say: nothing on screen', () => {
    expect(renderToStaticMarkup(<NoticeRegion toasts={[]} onToastDone={noop} />)).toBe('')
  })
})

describe('missing-picture placeholder', () => {
  it('to everyone else: no name, no blame', () => {
    const snapshot = fixtureSnapshot('missing', FIXTURE_BASE, { authorId: 'bob' })
    const html = renderToStaticMarkup(<MissingView snapshot={snapshot} emit={emit} />)
    expect(textOf(html)).toMatch(/^\d+s No picture this round$/)
    expect(html).toContain('picture-display')
  })

  it('speaks to you when it was yours', () => {
    const snapshot = fixtureSnapshot('missing', FIXTURE_BASE, { authorId: YOU_ID })
    const text = textOf(renderToStaticMarkup(<MissingView snapshot={snapshot} emit={emit} />))
    expect(text).toMatch(/^\d+s Your picture didn't make it this round$/)
  })

  it('a calm timer: no amber, red or pulse', () => {
    const snapshot = fixtureSnapshot('missing', FIXTURE_BASE, { authorId: 'bob' }) // 4s left: red, by the usual clock
    expect(renderToStaticMarkup(<MissingView snapshot={snapshot} emit={emit} />)).not.toMatch(/deadline-timer-(amber|red|pulse)/)
  })

  it('renders nothing outside its phase', () => {
    expect(renderToStaticMarkup(<MissingView snapshot={fixtureSnapshot('lie')} emit={emit} />)).toBe('')
  })
})

describe('uploading a picture', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const blob = new Blob([new Uint8Array([1])], { type: 'image/webp' })

  async function run(
    send: (url: string, init: RequestInit) => Promise<Response>,
    shrink?: (blob: Blob, step: number) => Promise<Blob | null>,
  ) {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(noop)
    const result = uploadPicture(send, '/submissions/TEST/1/you', blob, shrink)
    await vi.runAllTimersAsync()
    return result
  }

  it('lands first time', async () => {
    const send = vi.fn(() => Promise.resolve(new Response('ok', { status: 200 })))
    expect(await run(send)).toEqual({ ok: true })
    expect(send).toHaveBeenCalledTimes(1)
  })

  const generic = { ok: false, message: PICTURE_MESSAGES.generic, final: false }

  it('network failure: retries, then the generic failure with Try again', async () => {
    const send = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    expect(await run(send)).toEqual(generic)
    expect(send).toHaveBeenCalledTimes(UPLOAD_ATTEMPTS)
  })

  it('a server error is retried too, and can still land', async () => {
    const send = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    expect(await run(send)).toEqual({ ok: true })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it("409 too late: final, in fixed words (never the server's), no retry", async () => {
    const send = vi.fn(() => Promise.resolve(new Response(UPLOAD_MESSAGES.too_late, { status: 409 })))
    expect(await run(send)).toEqual({
      ok: false,
      message: "Didn't make it in time — the pictures were already showing. Your work is saved.",
      final: true,
    })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('413 too large: sent again smaller, without a word', async () => {
    const send = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(UPLOAD_MESSAGES.too_large, { status: 413 }))
      .mockResolvedValueOnce(new Response(UPLOAD_MESSAGES.too_large, { status: 413 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    const smaller = [new Blob([new Uint8Array(2)]), new Blob([new Uint8Array(1)])]
    const shrink = vi.fn((_: Blob, step: number) => Promise.resolve(smaller[step - 1] ?? null))
    expect(await run(send, shrink)).toEqual({ ok: true })
    expect(shrink.mock.calls.map((c) => c[1])).toEqual([1, 2])
    expect(send.mock.calls[2]?.[1].body).toBe(smaller[1])
  })

  it('413 with nothing smaller to send: the generic failure', async () => {
    const send = vi.fn(() => Promise.resolve(new Response('', { status: 413 })))
    expect(await run(send, () => Promise.resolve(null))).toEqual(generic)
  })

  it('any other refusal: the generic words, never a status code', async () => {
    const send = vi.fn(() => Promise.resolve(new Response('session does not own this player', { status: 403 })))
    expect(await run(send)).toEqual(generic)
  })

  it('a send that hangs: given up on within the budget, with Try again', async () => {
    // never answers, and ignores the abort too
    const send = vi.fn(() => new Promise<Response>(() => {}))
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(noop)
    const result = uploadPicture(send, '/submissions/TEST/1/you', blob)
    await vi.advanceTimersByTimeAsync(UPLOAD_BUDGET_MS + 5000)
    expect(await result).toEqual(generic)
  })
})

describe('a tap that did not count', () => {
  it('is told in fixed words, never the server text', () => {
    expect(actionErrorText('LIE_DUPLICATE')).toBe('Someone already wrote that — try something else.')
    expect(actionErrorText('INVALID_PAYLOAD')).toBe('That didn’t work. Try again.')
  })
})
