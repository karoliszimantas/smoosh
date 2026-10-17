import type { MoreTool } from './Toolbar'

// The More card's tools for a layer, instant ones first, then the ones that
// open a mode. Edge only for a cut-out: a whole photo has none to take off
export function layerMoreTools({
  full,
  limitLabel,
  mirrored,
  edged,
  onDuplicate,
  onMirror,
  onEdge,
  onCrop,
  onErase,
  onFade,
}: {
  full: boolean
  limitLabel: string
  mirrored: boolean
  edged: boolean
  onDuplicate: () => void
  onMirror: () => void
  onEdge?: () => void
  onCrop: () => void
  onErase: () => void
  onFade: () => void
}): MoreTool[] {
  return [
    { icon: 'duplicate', label: 'Copy', onPick: onDuplicate, disabled: full, ariaLabel: full ? limitLabel : 'Duplicate this layer' },
    { icon: 'mirror', label: 'Mirror', onPick: onMirror, checked: mirrored, ariaLabel: 'Mirror left to right' },
    ...(onEdge ? [{ icon: 'edge' as const, label: 'Edge', onPick: onEdge, checked: edged, ariaLabel: 'Sticker edge' }] : []),
    { icon: 'crop', label: 'Crop', onPick: onCrop },
    { icon: 'erase', label: 'Erase', onPick: onErase },
    { icon: 'opacity', label: 'Fade', onPick: onFade, ariaLabel: 'Opacity' },
  ]
}
