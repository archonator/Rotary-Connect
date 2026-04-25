import { useEffect } from 'react'
import { useStore } from '../store/useStore'

/**
 * Runs a 1-second interval that removes expired ephemeral messages.
 * Should be mounted once at the App level.
 */
export function useEphemeralCleanup(): void {
  const removeExpiredMessages = useStore(s => s.removeExpiredMessages)

  useEffect(() => {
    const id = setInterval(() => {
      removeExpiredMessages()
    }, 1000)
    return () => clearInterval(id)
  }, [removeExpiredMessages])
}
