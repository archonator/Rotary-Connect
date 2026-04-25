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
