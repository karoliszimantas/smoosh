import { DARK, LIGHT } from './index'
import { useThemeControl } from './useTheme'

const SUN = 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10z'
const MOON = 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

// Light or dark — Clean or Neon. Until the player taps, it's whatever the
// device is set to; after, their pick, remembered on this device. Switching
// is a context update: no reload, nothing remounts, no canvas state touched.
//
// inline (the lobby): both choices side by side. compact (in a round, in a
// corner): one button that flips it.
export default function ThemeSwitcher({ variant }: { variant: 'inline' | 'compact' }) {
  const { theme, setThemeId } = useThemeControl()
  const dark = theme.id === DARK.id

  if (variant === 'compact') {
    return (
      <button
        className="theme-toggle"
        role="switch"
        aria-checked={dark}
        aria-label="Dark mode"
        onClick={() => setThemeId(dark ? LIGHT.id : DARK.id)}
      >
        <Icon d={dark ? MOON : SUN} />
      </button>
    )
  }

  return (
    <div className="theme-choice" role="radiogroup" aria-label="Light or dark">
      {[LIGHT, DARK].map((t) => (
        <button
          key={t.id}
          role="radio"
          aria-checked={t.id === theme.id}
          className={`theme-choice-option${t.id === theme.id ? ' active' : ''}`}
          onClick={() => setThemeId(t.id)}
        >
          <Icon d={t.id === DARK.id ? MOON : SUN} />
          {t.id === DARK.id ? 'Dark' : 'Light'}
        </button>
      ))}
    </div>
  )
}
