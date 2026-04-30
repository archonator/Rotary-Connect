import { saveLog, loadOfflineQueue, saveOfflineQueue } from './storage'

/** Maximum retry attempts before a queued message is dropped (dead-lettered). */
const MAX_RETRIES = 5

export interface QueuedMessage {
  id: string
  chatType: 'dm' | 'room'
  chatId: string
  recipientOrRoomHash: string
  msgData: { type: string; content: string; name?: string }
  timestamp: number
  /** Number of failed publish attempts so far. Defaults to 0 for legacy entries. */
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

export function enqueue(msg: QueuedMessage): void {
  const queue = loadQueue()
  queue.push(msg)
  saveQueue(queue)
  saveLog('offline-queue', `Queued message for ${msg.chatId}`)
}

export function dequeue(id: string): void {
  const queue = loadQueue().filter(m => m.id !== id)
  saveQueue(queue)
}

export function getQueuedMessages(): QueuedMessage[] {
  return loadQueue()
}

export function isOnline(): boolean {
  return navigator.onLine
}

let flushCallback: ((msg: QueuedMessage) => Promise<void>) | null = null

export function setFlushCallback(cb: typeof flushCallback): void {
  flushCallback = cb
}

/** Increment the retry counter for a queued message (or drop it if maxed out). */
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

// Listen for online events and flush
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    saveLog('network', 'Back online — flushing offline queue')
    flushQueue()
  })
}
