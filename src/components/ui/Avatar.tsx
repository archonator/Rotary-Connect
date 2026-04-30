/**
 * Avatar — runder Initialen-Avatar.
 *
 * Aktuell extrem schlicht: nur der erste Buchstabe des Namens, mit
 * einem CSS-Modifier für Gruppen. Bewusst kein Lazy-Image, kein
 * Hash-basiertes Identicon — passt zum minimalistischen UI-Stil und
 * vermeidet jede Form von externem Asset-Loading.
 */

interface AvatarProps {
  name: string
  isGroup?: boolean
}

export function Avatar({ name, isGroup }: AvatarProps) {
  return (
    <div className={`avatar${isGroup ? ' group' : ''}`}>
      {name[0]?.toUpperCase() ?? '?'}
    </div>
  )
}
