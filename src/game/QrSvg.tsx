import { QUIET_ZONE, qrPath, type QrCode } from './qrCode'

// A QR code as crisp inline SVG, quiet zone included. Always dark on light,
// whatever the desk: its two colours are fixed (.qr-svg), never the theme's
export default function QrSvg({ qr, label }: { qr: QrCode; label: string }) {
  const side = qr.size + QUIET_ZONE * 2
  return (
    <svg
      className="qr-svg"
      viewBox={`0 0 ${side} ${side}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
    >
      <rect className="qr-svg-light" width={side} height={side} />
      <path className="qr-svg-dark" d={qrPath(qr)} />
    </svg>
  )
}
