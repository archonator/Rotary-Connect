/**
 * Offline-Queue für Nachrichten.
 *
 * Wenn der Browser keine Netzverbindung hat oder kein Relay erreichbar
 * ist, landen ausgehende Nachrichten hier. Sobald die App wieder online
 * ist (window 'online'-Event oder erneuter Relay-Connect), wird die
 * Queue der Reihe nach abgearbeitet.
 *
 * Eigenschaften:
 *   • Persistierung über `storage.saveOfflineQueue/loadOfflineQueue` —
 *     also vault-verschlüsselt, sodass im Klartext nichts auf der
 *     Disk liegt.
 *   • Pro Nachricht ein Retry-Counter: nach MAX_RETRIES wird sie
 *     verworfen ("Dead Letter"). Verhindert, dass eine dauerhaft
 *     fehlerhafte Nachricht (z. B. an einen gelöschten Empfänger) die
 *     Queue blockiert.
 *   • Beim Flush wird auch nach einem einzelnen Fehler weitergemacht,
 *     statt mit `break` abzubrechen.
 */

import { saveLog, loadOfflineQueue, saveOfflineQueue } from './storage'

/** Maximale Wiederholungen, bevor eine Nachricht verworfen wird. */
const MAX_RETRIES = 5

export interface QueuedMessage {
  id: string                                  // unique pro Nachricht (random)
  chatType: 'dm' | 'room'
  chatId: string                              // 'dm:<pubkey>' oder 'room:<hash>'
  recipientOrRoomHash: string                 // Empfänger-Pubkey oder Raum-Hash
  msgData: { type: string; content: string; name?: string }
  timestamp: number                           // Millisekunden, wann eingestellt
  /** Bisherige fehlgeschlagene Versuche. Fehlt bei alten (vor v1.x) Einträgen. */
  attempts?: number
}

function loadQueue(): QueuedMessage[] {
  try {
    const raw = loadOfflineQueue()
    if (!raw) return []
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function saveQueue(queue: QueuedMessage[]): void {
  try {
    saveOfflineQueue(JSON.stringify(queue))
  } catch (e) {
    saveLog('storage-error', `Failed to save offline queue: ${String(e)}`)
  }
}

/** Reiht eine neue Nachricht hinten ein. */
export function enqueue(msg: QueuedMessage): void {
  const queue = loadQueue()
  queue.push(msg)
  saveQueue(queue)
  saveLog('offline-queue', `Queued message for ${msg.chatId}`)
}

/** Entfernt einen einzelnen Eintrag (nach erfolgreichem Senden). */
export function dequeue(id: string): void {
  const queue = loadQueue().filter(m => m.id !== id)
  saveQueue(queue)
}

export function getQueuedMessages(): QueuedMessage[] {
  return loadQueue()
}

/** Wrapper um navigator.onLine — leichter mockbar in Tests. */
export function isOnline(): boolean {
  return navigator.onLine
}

/**
 * Vom Hook gesetzter Callback, der eine einzelne Queue-Nachricht
 * tatsächlich publisht. Wird in `useNostrRelays.ts` mit der DM-/Room-
 * Veröffentlichungslogik verkabelt.
 */
let flushCallback: ((msg: QueuedMessage) => Promise<void>) | null = null

export function setFlushCallback(cb: typeof flushCallback): void {
  flushCallback = cb
}

/**
 * Zählt den Retry-Counter einer Nachricht hoch oder entfernt sie
 * komplett, wenn MAX_RETRIES erreicht ist.
 */
function bumpAttempts(id: string): void {
  const queue = loadQueue()
  const idx = queue.findIndex(m => m.id === id)
  if (idx === -1) return
  const target = queue[idx]
  if (!target) return
  const nextAttempts = (target.attempts ?? 0) + 1
  if (nextAttempts >= MAX_RETRIES) {
    queue.splice(idx, 1)
    saveLog('offline-queue', `Dropped message ${id} after ${nextAttempts} failed attempts`)
  } else {
    queue[idx] = { ...target, attempts: nextAttempts }
  }
  saveQueue(queue)
}

export async function flushQueue(): Promise<void> {
  if (!flushCallback) return
  const queue = getQueuedMessages()
  if (queue.length === 0) return

  saveLog('offline-queue', `Flushing ${queue.length} queued message(s)`)
  for (const msg of queue) {
    try {
      await flushCallback(msg)
      dequeue(msg.id)
    } catch (e) {
      saveLog('offline-queue', `Failed to flush message ${msg.id}: ${String(e)} (attempt ${(msg.attempts ?? 0) + 1}/${MAX_RETRIES})`)
      bumpAttempts(msg.id)
      // Don't `break` — a single bad message must not block well-formed messages
      // queued after it. If the underlying failure is global (network down), the
      // remaining attempts will simply fail too and increment their counters.
    }
  }
}

// Wenn der Browser uns sagt "wieder online", flushen wir sofort.
// Modul-Top-Level-Code, weil diese Logik einmal pro Tab aktiv sein soll
// und der Listener kein Cleanup braucht.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    saveLog('network', 'Back online — flushing offline queue')
    flushQueue()
  })
}
