import { useEffect } from 'react'

// coming back to the tab (or the phone) picks up everyone else's changes
export function useOnVisible(refresh: () => void): void {
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])
}
