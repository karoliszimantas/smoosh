import { describe, it, expect, vi } from 'vitest'
import { nextPictureLabel, nextPictureSender } from './nextPicture'

describe('the host’s Next picture', () => {
  it('reads Next picture, and Scores after the round’s last picture', () => {
    expect(nextPictureLabel(0, 4)).toBe('Next picture')
    expect(nextPictureLabel(2, 4)).toBe('Next picture')
    expect(nextPictureLabel(3, 4)).toBe('Scores')
  })

  it('sends once per picture, however many taps land', async () => {
    const send = vi.fn(() => Promise.resolve({ ok: true }))
    const next = nextPictureSender(send)
    const taps = await Promise.all([next(2), next(2), next(2)])
    expect(taps).toEqual(['sent', 'already', 'already'])
    expect(await next(2)).toBe('already')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(2)
  })

  it('a refusal lets a later tap try again', async () => {
    const send = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true })
    const next = nextPictureSender(send)
    expect(await next(1)).toBe('refused')
    expect(await next(1)).toBe('sent')
    expect(send).toHaveBeenCalledTimes(2)
  })
})
