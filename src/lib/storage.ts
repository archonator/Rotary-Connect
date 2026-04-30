/**
 * Persistierungs-Schicht der App.
 *
 * Diese Datei ist der einzige Ort, an dem direkt auf `localStorage`
 * zugegriffen wird (außer in PinLock und vault.ts selbst). Alle Module
 * lesen und schreiben hier über typisierte Wrapper — `loadIdentity()`,
 * `saveContacts()` usw. Das hat zwei Effekte:
 *
 *   1. Sensible Werte gehen automatisch durch den Vault, ohne dass
 *      jeder Aufrufer sich um die AES-Geschichte kümmern muss.
 *   2. Der Speicherort ist an genau einer Stelle konfigurierbar.
 *
 * Cache-Strategie
 * ───────────────
 *   Vault-Verschlüsselung ist async (WebCrypto), die meisten Reads aber
 *   eher sync (UI-Render). Daher wird beim Unlock einmalig alles
 *   entschlüsselt in eine In-Memory-Map (`cache`) übertragen, und
 *   nachfolgende Reads liegen synchron daraus.
 *
 *   Solange der Vault verschlossen ist, ist der Cache **nicht**
 *   maßgeblich (er könnte veraltete Werte aus der vorigen Session
 *   enthalten). In diesem Zustand fällt `cachedRead` direkt auf
 *   localStorage zurück — das deckt sowohl Tests als auch den
 *   ersten Setup-Flow ab, in dem noch gar kein PIN gesetzt ist.
 */

import { vaultEncrypt, vaultDecrypt, isVaultUnlocked, isEncrypted } from './vault'
import type { Contact, Room, Message, Identity } from '../store/useStore'

/**
 * localStorage-Keys mit dem historischen `alina_`-Prefix.
 *
 * Wir behalten den Prefix bewusst, damit bestehende Nutzer nicht durch
 * eine Umbenennung ihre Daten verlieren würden. Neue Keys verwenden
 * den `rc-`-Prefix.
 */
const KEYS = {
  identity: 'alina_identity',
  contacts: 'alina_contacts',
  rooms: 'alina_rooms',
  messages: 'alina_messages',
  unread: 'alina_unread',
  logs: 'alina_logs', // Logs sind NICHT verschlüsselt — siehe unten
} as const

/**
 * Welche Keys sensiblen Inhalt tragen und durch den Vault MÜSSEN.
 * `alina_logs` steht bewusst NICHT hier: Logs sind Klartext, weil sie
 * potenziell vor dem Unlock geschrieben werden müssen (z. B. wenn ein
 * Fehler im Vault-Code selbst auftritt) und keine personenbezogenen
 * Daten enthalten sollen.
 */
const SENSITIVE_KEYS = new Set<string>([
  KEYS.identity,
  KEYS.contacts,
  KEYS.rooms,
  KEYS.messages,
  KEYS.unread,
  'alina_offline_queue', // separate Konstante in offlineQueue.ts
])

// ── In-Memory-Cache (befüllt nach Vault-Unlock) ──────────────────

const cache: Record<string, string | null> = {}

/**
 * Liest alle bekannten Keys aus localStorage, entschlüsselt sie wenn
 * nötig und legt sie als Klartext im Cache ab.
 *
 * Wird genau einmal aufgerufen, direkt nachdem der User seinen PIN
 * eingegeben hat. Ab da ist der Cache die Single Source of Truth für
 * alle synchronen Reads.
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
 * Verschlüsselt sämtliche aktuell noch in Klartext gespeicherten
 * sensiblen Daten. Wird nach `initVault()` aufgerufen, wenn ein
 * existierender User zum ersten Mal einen PIN setzt — die Daten aus
 * der Vor-Vault-Phase müssen ja in den Vault.
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

/**
 * True, wenn Identitätsdaten unverschlüsselt auf der Disk liegen
 * (Pre-Vault-User). Treibt den `vault-setup`-Phasenzweig in App.tsx,
 * der genau diese Daten in den Vault wandern lässt.
 */
export function hasPlaintextData(): boolean {
  const raw = localStorage.getItem(KEYS.identity)
  return !!raw && !isEncrypted(raw)
}

// ── Interne Helfer ───────────────────────────────────────────────

/**
 * Synchrone Read-Funktion mit Vault-bewusstem Fallback.
 *
 * Solange der Vault verschlossen ist, gehen wir direkt auf
 * localStorage. Nach dem Unlock hat `loadDecryptedCache()` jeden Key
 * im Cache materialisiert (entweder mit dem entschlüsselten Wert oder
 * `null`), und ab da ist der Cache verbindlich.
 */
function cachedRead(key: string): string | null {
  if (!isVaultUnlocked()) return localStorage.getItem(key)
  return cache[key] ?? null
}

/**
 * Schreibt einen Wert: aktualisiert sofort den Cache (damit nachfolgende
 * synchrone Reads den neuen Wert sehen) und persistiert verschlüsselt
 * im Hintergrund. Vor dem Vault-Setup landet der Wert temporär in
 * Klartext auf der Disk — er wird beim PIN-Setup von `migrateToVault()`
 * übernommen.
 */
function encryptedSave(key: string, plaintext: string): void {
  cache[key] = plaintext
  if (isVaultUnlocked()) {
    vaultEncrypt(plaintext)
      .then(encrypted => safeSave(key, encrypted))
      .catch(e => console.error(`Failed to encrypt ${key}:`, e))
  } else {
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

// ── Identität ────────────────────────────────────────────────────
//
// Privkey wird als JSON-Array von Bytes serialisiert (JSON kann mit
// Uint8Array nicht umgehen) und beim Laden wieder rekonstruiert.

export function loadIdentity(): Identity | null {
  try {
    const raw = cachedRead(KEYS.identity)
    if (!raw) return null
    const data = JSON.parse(raw)
    return {
      privkey: new Uint8Array(data.privkey),
      pubkey: data.pubkey,
      name: data.name || 'Ich', // Fallback, falls beim Schreiben mal kein Name dabei war
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

// ── Logs (BEWUSST NICHT verschlüsselt) ───────────────────────────
//
// Debug-Log als Ringpuffer (max. 100 Einträge). Logs müssen auch vor
// dem Vault-Unlock und im Fehlerfall (Vault kaputt o.ä.) schreibbar
// sein, deshalb Klartext. Inhalt darf entsprechend nur unkritische
// Diagnosedaten enthalten — Pubkey-Präfixe ja, Klartext-Nachrichten
// nein.

export interface LogEntry {
  ts: string      // ISO-Timestamp
  type: string    // Kategorie, z. B. 'relay', 'webrtc-error', 'migration'
  message: string // freier Text, max. 500 Zeichen (siehe saveLog)
}

const MAX_LOGS = 100

export function loadLogs(): LogEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEYS.logs) || '[]')
  } catch {
    return []
  }
}

/**
 * Hängt einen Log-Eintrag an den Ringpuffer an.
 * Trimmt den Puffer auf MAX_LOGS und kappt jede Nachricht bei 500
 * Zeichen, damit ein dauerhaft loggender Bug die localStorage-Quota
 * nicht vollschreibt.
 *
 * Wirft bewusst nicht, falls localStorage voll ist — Logs sind
 * best-effort, sie dürfen die App nicht crashen.
 */
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

/**
 * Löscht ALLES — vom Logout-Flow aufgerufen.
 * Inklusive des In-Memory-Caches, damit keine Geister aus der vorigen
 * Session in einer neu angelegten Identität auftauchen.
 */
export function clearAll(): void {
  localStorage.clear()
  for (const k of Object.keys(cache)) delete cache[k]
}
