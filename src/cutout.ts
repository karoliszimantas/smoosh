import { removeBackground, preload, type Config } from '@imgly/background-removal'

const config: Config = {
  model: 'isnet_quint8',
  output: { format: 'image/png', quality: 0.8 },
}

export type CutoutState = 'idle' | 'loading' | 'ready' | 'failed'

let state: CutoutState = 'idle'
export const getState = () => state

export async function warmup(onProgress?: (pct: number) => void) {
  if (state !== 'idle') return
  state = 'loading'
  const t0 = performance.now()

  try {
    await preload({
      ...config,
      progress: (key, current, total) => {
        onProgress?.(Math.round((current / total) * 100))
        console.log('preload', key, current, total)
      },
    })
    state = 'ready'
    console.log('model ready in', Math.round(performance.now() - t0), 'ms')
  } catch (e) {
    state = 'failed'
    console.error('preload failed', e)
  }
}

export async function cutout(src: string): Promise<string> {
  const t0 = performance.now()

  const res = await fetch(src)
  const inputBlob = await res.blob()

  const blob = await removeBackground(inputBlob, config)
  console.log('cutout took', Math.round(performance.now() - t0), 'ms')
  return URL.createObjectURL(blob)
}