/**
 * useEphemeralCleanup — entfernt abgelaufene "selbstlöschende"
 * Nachrichten in Echtzeit.
 *
 * Verwendung: einmal am App-Root mounten (siehe App.tsx). Der Hook
 * tickt einmal pro Sekunde und ruft `removeExpiredMessages()` im Store
 * auf, das wiederum alle Nachrichten mit `expiresAt < now` löscht und
 * die persistierte Version aktualisiert.
 *
 * 1 s ist ein Kompromiss: feiner als das Sekunden-Granularität-TTL,
 * aber nicht so fein, dass es einen Render-Sturm gibt. UI-Countdowns
 * in den einzelnen Bubble-Komponenten ticken ebenfalls jede Sekunde.
 */

import { useEffect } from 'react'
import { useStore } from '../store/useStore'

export function useEphemeralCleanup(): void {
  const removeExpiredMessages = useStore(s => s.removeExpiredMessages)

  useEffect(() => {
    const id = setInterval(() => {
      removeExpiredMessages()
    }, 1000)
    return () => clearInterval(id)
  }, [removeExpiredMessages])
}
