import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { UPLOAD_MESSAGES } from '@smoosh/protocol'
import UploadStatus from './UploadStatus'
import GameNotice from './GameNotice'
import ReconnectBanner from './ReconnectBanner'
import MissingView from './phases/MissingView'
import { uploadPicture, UPLOAD_ATTEMPTS } from './upload'
import { fixtureSnapshot, FIXTURE_BASE, YOU_ID } from '../dev/fixtures'

// The screens only the unluckiest player sees — nobody hits them by
// accident, so these keep them from changing unnoticed. They pin today's
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

  it('failed, worth retrying: says why and offers Try again', () => {
    const message = 'Could not send your picture — check your connection'
    const html = renderToStaticMarkup(
      <UploadStatus state={{ status: 'failed', message, canRetry: true }} onRetry={noop} />,
    )
    expect(html).toContain('role="alert"')
    expect(textOf(html)).toContain(message)
    expect(buttonsOf(html)).toEqual(['Try again'])
  })

  it('refused for good: says why, no Try again', () => {
    const html = renderToStaticMarkup(
      <UploadStatus state={{ status: 'failed', message: UPLOAD_MESSAGES.too_late, canRetry: false }} onRetry={noop} />,
    )
    expect(textOf(html)).toBe(UPLOAD_MESSAGES.too_late)
    expect(buttonsOf(html)).toEqual([])
  })
})

describe('banners', () => {
  it('a refusal after the round moved on: the message, and a way to dismiss it', () => {
    const html = renderToStaticMarkup(<GameNotice message={UPLOAD_MESSAGES.too_late} onDismiss={noop} />)
    expect(html).toContain('role="alert"')
    expect(textOf(html)).toContain(UPLOAD_MESSAGES.too_late)
    expect(html).toMatch(/<button aria-label="Dismiss">/)
  })

  it('a dropped connection', () => {
    expect(textOf(renderToStaticMarkup(<ReconnectBanner />))).toBe('Reconnecting…')
  })
})

describe('missing-picture placeholder', () => {
  it("names the player whose picture didn't arrive", () => {
    const snapshot = fixtureSnapshot('missing', FIXTURE_BASE, { authorId: 'bob' })
    const text = textOf(renderToStaticMarkup(<MissingView snapshot={snapshot} emit={emit} />))
    expect(text).toContain('Bob’s picture didn’t arrive')
    expect(text).toContain('It never reached the server in time, so there’s nothing to show for this one.')
  })

  it('speaks to you when it was yours', () => {
    const snapshot = fixtureSnapshot('missing', FIXTURE_BASE, { authorId: YOU_ID })
    const text = textOf(renderToStaticMarkup(<MissingView snapshot={snapshot} emit={emit} />))
    expect(text).toContain('Your picture didn’t arrive')
    expect(text).not.toContain('Sam')
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

  async function run(send: (url: string, init: RequestInit) => Promise<Response>) {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(noop)
    const result = uploadPicture(send, '/submissions/TEST/1/you', blob)
    await vi.runAllTimersAsync()
    return result
  }

  it('lands first time', async () => {
    const send = vi.fn(() => Promise.resolve(new Response('ok', { status: 200 })))
    expect(await run(send)).toEqual({ ok: true })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('network failure: retries, then gives up with a retryable failure', async () => {
    const send = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    expect(await run(send)).toEqual({
      ok: false,
      message: 'Could not send your picture — check your connection',
      final: false,
    })
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

  it("409 too late: final, with the server's words, no retry", async () => {
    const send = vi.fn(() => Promise.resolve(new Response(UPLOAD_MESSAGES.too_late, { status: 409 })))
    expect(await run(send)).toEqual({ ok: false, message: UPLOAD_MESSAGES.too_late, final: true })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("413 too large: final, with the server's words, no retry", async () => {
    const send = vi.fn(() => Promise.resolve(new Response(UPLOAD_MESSAGES.too_large, { status: 413 })))
    expect(await run(send)).toEqual({ ok: false, message: UPLOAD_MESSAGES.too_large, final: true })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('a refusal with no words falls back to the status code', async () => {
    const send = vi.fn(() => Promise.resolve(new Response('', { status: 403 })))
    expect(await run(send)).toEqual({ ok: false, message: 'Your picture was refused (403)', final: true })
  })
})
