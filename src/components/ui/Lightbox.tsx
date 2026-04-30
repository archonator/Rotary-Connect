/**
 * Lightbox — Vollbildanzeige für Bildnachrichten.
 *
 * Click auf die Overlay schließt sie wieder. Wenn `src === null`
 * wird gar nichts gerendert — kein leeres Overlay-Layer in DOM,
 * weniger Performance-Overhead.
 */

interface LightboxProps {
  src: string | null
  onClose: () => void
}

export function Lightbox({ src, onClose }: LightboxProps) {
  if (!src) return null

  return (
    <div className="lightbox open" id="lightbox" onClick={onClose}>
      <img src={src} alt="" />
    </div>
  )
}
