/**
 * EmojiPicker — minimalistischer Emoji-Picker für ChatInput.
 *
 * Zeigt eine fixe Liste von 30 Emojis aus `lib/constants.ts`.
 * Bewusst keine externe Lib (kein Twemoji, kein heavy Picker) —
 * die ~1 KB an Konstanten reichen für 95 % der typischen Nutzung
 * und sparen massiv Bundle-Size.
 */

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
