import { vaultEncrypt, vaultDecrypt, isVaultUnlocked, isEncrypted } from './vault'
import type { Contact, Room, Message, Identity } from '../store/useStore'

const KEYS = {
  identity: 'alina_identity',
  contacts: 'alina_contacts',
  rooms: 'alina_rooms',
  messages: 'alina_messages',
  unread: 'alina_unread',
  logs: 'alina_logs',
} as const

/** Keys that contain sensitive data and MUST be encrypted */
const SENSITIVE_KEYS = new Set<string>([
  KEYS.identity,
  KEYS.contacts,
  KEYS.rooms,
  KEYS.messages,
  KEYS.unread,
  'alina_offline_queue',
])

// ── In-memory cache (populated on vault unlock) ──────────────────

const cache: Record<string, string | null> = {}

/**
 * Populate cache by decrypting all stored values.
 * Call once after vault unlock.
 */
export async function loadDecryptedCache(): Promise<void> {
  const keysToLoad = [...Object.values(KEYS), 'alina_offline_queue']
  for (const key of keysToLoad) {
    const raw = localStorage.getItem(key)
    if (!raw) {
      cache[key] = null
      continue
    }
    if (SENSITIVE_KEYS.has(key) && isEncrypted(raw)) {
      try {
        cache[key] = await vaultDecrypt(raw)
      } catch {
        cache[key] = null
      }
    } else {
      cache[key] = raw
    }
  }
}

/**
 * Encrypt all existing plaintext sensitive data in localStorage.
 * Call after initVault() for migrating existing users.
 */
export async function migrateToVault(): Promise<void> {
  for (const key of Object.values(KEYS)) {
    if (!SENSITIVE_KEYS.has(key)) continue
    const raw = localStorage.getItem(key)
    if (!raw || isEncrypted(raw)) continue
    try {
      cache[key] = raw
      const encrypted = await vaultEncrypt(raw)
      localStorage.setItem(key, encrypted)
    } catch (e) {
      console.error(`Failed to encrypt ${key}:`, e)
    }
  }

  // Migrate offline queue
  const queueRaw = localStorage.getItem('alina_offline_queue')
  if (queueRaw && !isEncrypted(queueRaw)) {
    try {
      cache['alina_offline_queue'] = queueRaw
      const encrypted = await vaultEncrypt(queueRaw)
      localStorage.setItem('alina_offline_queue', encrypted)
    } catch (e) {
      console.error('Failed to encrypt offline queue:', e)
    }
  }
}

/** Check if plaintext (unencrypted) identity data exists */
export function hasPlaintextData(): boolean {
  const raw = localStorage.getItem(KEYS.identity)
  return !!raw && !isEncrypted(raw)
}

// ── Internal helpers ─────────────────────────────────────────────

/** Read from decrypted cache (sync) */
function cachedRead(key: string): string | null {
  return cache[key] ?? null
}

/** Write to cache + async encrypted save to localStorage */
function encryptedSave(key: string, plaintext: string): void {
  cache[key] = plaintext
  if (isVaultUnlocked()) {
    vaultEncrypt(plaintext)
      .then(encrypted => safeSave(key, encrypted))
      .catch(e => console.error(`Failed to encrypt ${key}:`, e))
  } else {
    // Vault not yet initialized — save plaintext temporarily.
    // Will be encrypted immediately on vault setup (migration path).
    safeSave(key, plaintext)
  }
}

/** Safe localStorage.setItem with quota error handling */
function safeSave(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch (e) {
    console.error(`localStorage quota exceeded for key "${key}":`, e)
    saveLog('storage-error', `Quota exceeded saving "${key}" (${Math.round(value.length / 1024)} KB)`)
    return false
  }
}

// ── Identity ─────────────────────────────────────────────────────

export function loadIdentity(): Identity | null {
  try {
    const raw = cachedRead(KEYS.identity)
    if (!raw) return null
    const data = JSON.parse(raw)
    return {
      privkey: new Uint8Array(data.privkey),
      pubkey: data.pubkey,
      name: data.name || 'Ich',
    }
  } catch (e) {
    console.error('Failed to load identity:', e)
    return null
  }
}

export function saveIdentity(identity: Identity): void {
  encryptedSave(
    KEYS.identity,
    JSON.stringify({
      privkey: Array.from(identity.privkey),
      pubkey: identity.pubkey,
      name: identity.name,
    }),
  )
}

// ── Contacts ─────────────────────────────────────────────────────

export function loadContacts(): Record<string, Contact> {
  try {
    return JSON.parse(cachedRead(KEYS.contacts) || '{}')
  } catch (e) {
    console.error('Failed to load contacts:', e)
    return {}
  }
}

export function saveContacts(contacts: Record<string, Contact>): void {
  encryptedSave(KEYS.contacts, JSON.stringify(contacts))
}

// ── Rooms ────────────────────────────────────────────────────────

export function loadRooms(): Record<string, Room> {
  try {
    return JSON.parse(cachedRead(KEYS.rooms) || '{}')
  } catch (e) {
    console.error('Failed to load rooms:', e)
    return {}
  }
}

export function saveRooms(rooms: Record<string, Room>): void {
  encryptedSave(KEYS.rooms, JSON.stringify(rooms))
}

// ── Messages ─────────────────────────────────────────────────────

export function loadMessages(): Record<string, Message[]> {
  try {
    return JSON.parse(cachedRead(KEYS.messages) || '{}')
  } catch (e) {
    console.error('Failed to load messages:', e)
    return {}
  }
}

export function saveMessages(messages: Record<string, Message[]>): void {
  encryptedSave(KEYS.messages, JSON.stringify(messages))
}

// ── Unread ───────────────────────────────────────────────────────

export function loadUnread(): Record<string, number> {
  try {
    return JSON.parse(cachedRead(KEYS.unread) || '{}')
  } catch (e) {
    console.error('Failed to load unread counts:', e)
    return {}
  }
}

export function saveUnread(unread: Record<string, number>): void {
  encryptedSave(KEYS.unread, JSON.stringify(unread))
}

// ── Offline Queue (for offlineQueue.ts) ──────────────────────────

export function loadOfflineQueue(): string | null {
  return cachedRead('alina_offline_queue')
}

export function saveOfflineQueue(json: string): void {
  encryptedSave('alina_offline_queue', json)
}

// ── Logs (NOT encrypted — non-sensitive debug data) ──────────────

export interface LogEntry {
  ts: string
  type: string
  message: string
}

const MAX_LOGS = 100

export function loadLogs(): LogEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEYS.logs) || '[]')
  } catch {
    return []
  }
}

export function saveLog(type: string, message: string): void {
  try {
    const logs = loadLogs()
    logs.push({ ts: new Date().toISOString(), type, message: message.slice(0, 500) })
    if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS)
    localStorage.setItem(KEYS.logs, JSON.stringify(logs))
  } catch {
    /* ignore */
  }
}

export function clearLogs(): void {
  localStorage.removeItem(KEYS.logs)
}

export function clearAll(): void {
  localStorage.clear()
}
