/**
 * StatusBar — kleine Toast-ähnliche Anzeige am unteren Bildschirmrand.
 *
 * Wird von store.showStatus(msg, duration?) gesteuert: wenn
 * `statusMessage` gesetzt ist, sieht man ein kurzes "Banner" am
 * unteren Rand; nach Ablauf der Duration (oder hideStatus) wird der
 * State zurückgesetzt und die Komponente rendert null.
 */

import { useStore } from '../../store/useStore'

export function StatusBar() {
  const statusMessage = useStore(s => s.statusMessage)

  if (!statusMessage) return null

  return (
    <div className="status-bar" style={{ display: 'block' }}>
      {statusMessage}
    </div>
  )
}
