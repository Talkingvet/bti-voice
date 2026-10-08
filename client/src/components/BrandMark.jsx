/* The product mark — one phone glyph on a blue tile, used by the title bar,
   splash, login and About so the brand looks the same everywhere (batch 8).
   `size` is the tile in px; the glyph scales with it. Never carries text, so
   it is safe to show before the deploy's brand name is known. */
export default function BrandMark({ size = 20, radius, style }) {
  const glyph = Math.round(size * 0.55)
  return (
    <div
      aria-hidden="true"
      style={{
        width: size, height: size, borderRadius: radius ?? Math.round(size / 4),
        background: 'linear-gradient(135deg,#2563eb,#4f9cf9)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        ...style,
      }}
    >
      <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.42 2 2 0 0 1 3.58 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.16 6.16l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
      </svg>
    </div>
  )
}
