import { EMOJIS } from '../../lib/constants'

interface EmojiPickerProps {
  open: boolean
  onSelect: (emoji: string) => void
  onClose: () => void
}

export function EmojiPicker({ open, onSelect, onClose }: EmojiPickerProps) {
  if (!open) return null

  return (
    <div className="emoji-picker open" onClick={e => e.stopPropagation()}>
      {EMOJIS.map(e => (
        <span
          key={e}
          className="emoji-opt"
          onClick={() => { onSelect(e); onClose() }}
        >
          {e}
        </span>
      ))}
    </div>
  )
}
