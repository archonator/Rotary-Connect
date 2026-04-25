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
