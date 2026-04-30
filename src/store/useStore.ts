/**
 * Globaler Anwendungszustand (Zustand-Store).
 *
 * Eine einzige Quelle der Wahrheit für ALLES, was die UI rendert:
 * Identität, Kontakte, Räume, Nachrichten, ungelesene Zähler,
 * UI-Modi (geöffnete Modale, Sidebar offen?), aktive Chats, …
 *
 * Wir nutzen Zustand statt Redux/Context, weil:
 *   • Selektoren sind synchron, ohne Provider-Pflicht.
 *   • Updates fließen direkt durch `set(...)` — keine Reducer-Boilerplate.
 *   • Keine Re-Render-Stürme: jede Komponente subscribed nur die Slices,
 *     die sie braucht.
 *
 * Persistierung läuft über `lib/storage.ts`. Sensible Werte
 * (Identität, Kontakte, Räume, Nachrichten, Unread, Offline-Queue)
 * werden vault-verschlüsselt; UI-Zustand bleibt im RAM.
 */

import { create } from 'zustand'
import * as storage from '../lib/storage'
import { createKeyPair, pubkeyFromPrivkey, decodeNsec, decodeNpub } from '../lib/crypto'
import { MAX_MESSAGES_PER_CHAT } from '../lib/constants'
import type { Lang } from '../lib/i18n'
import type { PeerState } from '../lib/webrtc/types'

/**
 * Die eigene Identität: Schlüsselpaar plus Anzeigename.
 * `privkey` ist ein 32-Byte-Uint8Array (secp256k1 secret key),
 * `pubkey` der zugehörige hex-string (64 Zeichen).
 */
export interface Identity {
  privkey: Uint8Array
  pubkey: string
  name: string
}

/** Ein gespeicherter Kontakt. */
export interface Contact {
  pubkey: string
  name: string
}

/** Ein bekannter Gruppenraum. */
export interface Room {
  name: string         // vom User vergebener Name (case-sensitiv für Anzeige)
  hash: string         // SHA-256 von "alina-room-v1:" + name.toLowerCase()
  members: string[]    // bekannte Mitglieder (Pubkeys), wachsend per Discovery
}

/** Eine einzelne Nachricht im Store. */
export interface Message {
  type: 'text' | 'image' | 'location'
  content: string                 // Text, Base64-Bild oder JSON {lat,lng}
  pubkey: string                  // Sender-Pubkey
  name?: string                   // Anzeigename des Senders (in Räumen)
  ts: number                      // Sendezeitpunkt in ms
  eventId?: string                // Nostr-Event-ID (DMs) oder seal.id (Räume)
  translated?: string             // Auto-übersetzte Version (nur Text)
  detectedLang?: string           // Erkannte Quellsprache (nur Text)
  ttl?: number                    // Time-to-Live in Sekunden
  expiresAt?: number              // Absoluter Ablaufzeitpunkt in ms
  status?: 'sending' | 'sent' | 'failed' // Lieferstatus eigener Nachrichten
}

/** Welcher Chat ist gerade rechts geöffnet? */
export interface ActiveChat {
  type: 'dm' | 'room'
  id: string
  name: string
  chatId: string
}

interface AppState {
  // Identity
  identity: Identity | null
  createIdentity: (name: string) => void
  importIdentity: (nsec: string, name: string) => void
  updateName: (name: string) => void
  logout: () => void

  // Vault hydration
  hydrate: () => void

  // Contacts
  contacts: Record<string, Contact>
  addContact: (pubkey: string, name: string) => void
  ensureContact: (pubkey: string, name: string) => void
  renameContact: (pubkey: string, name: string) => void
  deleteContact: (pubkey: string) => void
  /** Move all data from oldPubkey to newPubkey (used after a verified key rotation) */
  migrateContact: (oldPubkey: string, newPubkey: string) => void

  // Rooms
  rooms: Record<string, Room>
  addRoom: (hash: string, name: string) => void
  addRoomMember: (hash: string, pubkey: string) => void

  // Messages
  messages: Record<string, Message[]>
  addMessage: (chatId: string, msg: Message) => boolean // returns false if duplicate

  // Active chat
  activeChat: ActiveChat | null
  setActiveChat: (chat: ActiveChat | null) => void

  // Unread
  unread: Record<string, number>
  clearUnread: (chatId: string) => void
  incrementUnread: (chatId: string) => void

  // Relay status
  relayCount: number
  setRelayCount: (n: number) => void

  // WebRTC peer states
  peerStates: Record<string, PeerState>
  setPeerState: (pubkey: string, state: PeerState) => void

  // Language
  lang: Lang
  setLang: (lang: Lang) => void

  // Ephemeral messages
  removeExpiredMessages: () => void

  // Auto-translate
  autoTranslate: boolean
  setAutoTranslate: (v: boolean) => void
  allowExternalTranslation: boolean
  setAllowExternalTranslation: (v: boolean) => void
  // Notifications
  vibrateOnIncoming: boolean
  setVibrateOnIncoming: (v: boolean) => void
  setMessageTranslation: (chatId: string, ts: number, pubkey: string, translated: string, detectedLang: string) => void
  updateMessageStatus: (chatId: string, ts: number, pubkey: string, status: 'sending' | 'sent' | 'failed') => void

  // UI
  openModal: string | null
  setOpenModal: (id: string | null) => void
  statusMessage: string | null
  statusTimeout: ReturnType<typeof setTimeout> | null
  showStatus: (msg: string, duration?: number) => void
  hideStatus: () => void
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
}

export const useStore = create<AppState>((set, get) => ({
  // ── Identity (starts null — populated by hydrate() after vault unlock) ──

  identity: null,

  /**
   * Lädt alle persistierten Werte aus dem entschlüsselten Storage-Cache
   * in den Store. Wird einmalig nach dem PIN-Unlock + loadDecryptedCache
   * aufgerufen und triggert das initiale Render der App.
   */
  hydrate: () => {
    set({
      identity: storage.loadIdentity(),
      contacts: storage.loadContacts(),
      rooms: storage.loadRooms(),
      messages: storage.loadMessages(),
      unread: storage.loadUnread(),
    })
  },

  createIdentity: (name) => {
    const { privkey, pubkey } = createKeyPair()
    const identity: Identity = { privkey, pubkey, name }
    storage.saveIdentity(identity)
    set({ identity })
  },

  importIdentity: (nsec, name) => {
    const privkey = decodeNsec(nsec)
    const pubkey = pubkeyFromPrivkey(privkey)
    const identity: Identity = { privkey, pubkey, name }
    storage.saveIdentity(identity)
    // Also load any existing data associated with this identity
    const contacts = storage.loadContacts()
    const rooms = storage.loadRooms()
    const messages = storage.loadMessages()
    const unread = storage.loadUnread()
    set({ identity, contacts, rooms, messages, unread })
  },

  updateName: (name) => {
    const { identity } = get()
    if (!identity) return
    const updated = { ...identity, name }
    storage.saveIdentity(updated)
    set({ identity: updated })
  },

  logout: () => {
    storage.clearAll()
    set({
      identity: null,
      contacts: {},
      rooms: {},
      messages: {},
      unread: {},
      activeChat: null,
    })
  },

  // Contacts
  contacts: {},

  addContact: (pubkey, name) => {
    const { contacts } = get()
    let hexPubkey = pubkey
    if (pubkey.startsWith('npub')) {
      hexPubkey = decodeNpub(pubkey)
    }
    const updated = { ...contacts, [hexPubkey]: { pubkey: hexPubkey, name } }
    storage.saveContacts(updated)
    set({ contacts: updated })
  },

  /**
   * Idempotente Variante von addContact: legt einen Kontakt nur dann
   * an, wenn er noch nicht existiert. Wird vom Empfangshandler benutzt,
   * wenn eine DM von einem unbekannten Pubkey reinkommt — damit der
   * Chat überhaupt aufgelistet werden kann.
   */
  ensureContact: (pubkey, name) => {
    const { contacts } = get()
    if (contacts[pubkey]) return
    const updated = { ...contacts, [pubkey]: { pubkey, name } }
    storage.saveContacts(updated)
    set({ contacts: updated })
  },

  renameContact: (pubkey, name) => {
    const { contacts } = get()
    if (!contacts[pubkey]) return
    const updated = { ...contacts, [pubkey]: { ...contacts[pubkey], name } }
    storage.saveContacts(updated)
    set({ contacts: updated })
  },

  /**
   * Migriert einen Kontakt, der seinen Schlüssel rotiert hat, vom
   * alten auf den neuen Pubkey. Wird vom Migrations-Handler in
   * useNostrRelays gerufen, NACHDEM die Cross-Signature verifiziert
   * wurde.
   *
   * Übernimmt:
   *   • Kontakt-Eintrag (Name bleibt, Pubkey wechselt)
   *   • Chat-History unter neuem chatId, Pubkey-Felder einzelner
   *     Nachrichten werden ebenfalls aktualisiert.
   *   • Ungelesen-Counter (addiert, falls beide Seiten welche hatten)
   *   • activeChat, falls gerade dieser Chat geöffnet war.
   *
   * No-op, wenn der alte Pubkey unbekannt ist (kein Kontakt zum
   * Migrieren) oder wenn old === new.
   */
  migrateContact: (oldPubkey, newPubkey) => {
    if (oldPubkey === newPubkey) return
    const { contacts, messages, unread, activeChat } = get()
    const oldContact = contacts[oldPubkey]
    if (!oldContact) return

    // 1. Kontakt-Eintrag verschieben
    const updatedContacts = { ...contacts }
    delete updatedContacts[oldPubkey]
    updatedContacts[newPubkey] = { ...oldContact, pubkey: newPubkey }

    // 2. Chat-Historie unter dem neuen chatId fortschreiben
    const oldChatId = 'dm:' + oldPubkey
    const newChatId = 'dm:' + newPubkey
    const updatedMessages: Record<string, Message[]> = { ...messages }
    if (updatedMessages[oldChatId]) {
      // Auch jede einzelne Nachricht: pubkey rewriten, sonst würde die
      // UI noch gegen den alten Wert prüfen ("ist von mir?" etc.).
      const carried = (updatedMessages[oldChatId] || []).map(m =>
        m.pubkey === oldPubkey ? { ...m, pubkey: newPubkey } : m,
      )
      updatedMessages[newChatId] = [...(updatedMessages[newChatId] || []), ...carried]
      delete updatedMessages[oldChatId]
    }

    // 3. Ungelesen-Counter und activeChat mitnehmen
    const updatedUnread = { ...unread }
    if (updatedUnread[oldChatId] !== undefined) {
      updatedUnread[newChatId] = (updatedUnread[newChatId] || 0) + (updatedUnread[oldChatId] || 0)
      delete updatedUnread[oldChatId]
    }
    const updatedActiveChat = activeChat?.chatId === oldChatId
      ? { ...activeChat, id: newPubkey, chatId: newChatId }
      : activeChat

    storage.saveContacts(updatedContacts)
    storage.saveMessages(updatedMessages)
    storage.saveUnread(updatedUnread)
    set({
      contacts: updatedContacts,
      messages: updatedMessages,
      unread: updatedUnread,
      activeChat: updatedActiveChat,
    })
  },

  deleteContact: (pubkey) => {
    const { contacts, messages, unread, activeChat } = get()
    const updatedContacts = { ...contacts }
    delete updatedContacts[pubkey]
    storage.saveContacts(updatedContacts)

    const chatId = 'dm:' + pubkey
    const updatedMessages = { ...messages }
    delete updatedMessages[chatId]
    storage.saveMessages(updatedMessages)

    const updatedUnread = { ...unread }
    delete updatedUnread[chatId]
    storage.saveUnread(updatedUnread)

    set({
      contacts: updatedContacts,
      messages: updatedMessages,
      unread: updatedUnread,
      activeChat: activeChat?.chatId === chatId ? null : activeChat,
    })
  },

  // Rooms
  rooms: {},

  /**
   * Legt einen Raum an oder behält die Member-Liste eines bereits
   * existierenden Raumes mit demselben Hash bei. Wir starten mit dem
   * eigenen Pubkey als Mitglied, damit Sender-Listen für Gift Wraps
   * sofort funktionieren.
   */
  addRoom: (hash, name) => {
    const { rooms, identity } = get()
    const members = identity ? [identity.pubkey] : []
    const existing = rooms[hash]
    const updated = { ...rooms, [hash]: { name, hash, members: existing?.members ?? members } }
    storage.saveRooms(updated)
    set({ rooms: updated })
  },

  /** Fügt einen Pubkey zur Member-Liste eines Raumes hinzu (idempotent). */
  addRoomMember: (hash, pubkey) => {
    const { rooms } = get()
    const room = rooms[hash]
    if (!room) return
    if (room.members.includes(pubkey)) return
    const updated = { ...rooms, [hash]: { ...room, members: [...room.members, pubkey] } }
    storage.saveRooms(updated)
    set({ rooms: updated })
  },

  // Messages
  messages: {},

  /**
   * Fügt eine Nachricht zur entsprechenden Chat-Historie hinzu.
   *
   * Deduplizierung:
   *   • Hat die Nachricht eine `eventId`, ist DAS der Vergleichsschlüssel
   *     (Nostr-Event-IDs sind global einmalig, plus seal.id für NIP-17-
   *     Räume — siehe nostr.ts).
   *   • Sonst (lokal erzeugte Nachrichten ohne Server-Bestätigung):
   *     Tupel (ts, pubkey). Selten kollisionsbehaftet, aber für die
   *     Sub-Sekunden-Granularität von ts ausreichend.
   *
   * Liefert true zurück, wenn die Nachricht neu war — Aufrufer nutzen
   * das, um z. B. den Unread-Counter nur einmal hochzuzählen.
   *
   * Cap auf MAX_MESSAGES_PER_CHAT (200): bei längerer Historie wird
   * vorne abgeschnitten — der Messenger ist als Rolling-History gedacht.
   */
  addMessage: (chatId, msg) => {
    const { messages } = get()
    const existing = messages[chatId] || []
    const dup = msg.eventId
      ? existing.find(m => m.eventId === msg.eventId)
      : existing.find(m => m.ts === msg.ts && m.pubkey === msg.pubkey)
    if (dup) return false

    let updated = [...existing, msg]
    if (updated.length > MAX_MESSAGES_PER_CHAT) {
      updated = updated.slice(-MAX_MESSAGES_PER_CHAT)
    }
    const newMessages = { ...messages, [chatId]: updated }
    storage.saveMessages(newMessages)
    set({ messages: newMessages })
    return true
  },

  // Active chat
  activeChat: null,

  setActiveChat: (chat) => {
    set({ activeChat: chat })
    if (chat) {
      get().clearUnread(chat.chatId)
    }
  },

  // Unread
  unread: {},

  clearUnread: (chatId) => {
    const { unread } = get()
    if (!unread[chatId]) return
    const updated = { ...unread, [chatId]: 0 }
    storage.saveUnread(updated)
    set({ unread: updated })
  },

  incrementUnread: (chatId) => {
    const { unread } = get()
    const updated = { ...unread, [chatId]: (unread[chatId] || 0) + 1 }
    storage.saveUnread(updated)
    set({ unread: updated })
  },

  // Relay status
  relayCount: 0,
  setRelayCount: (n) => set({ relayCount: n }),

  // WebRTC peer states
  peerStates: {},
  setPeerState: (pubkey, state) => {
    const { peerStates } = get()
    if (state === 'disconnected') {
      const updated = { ...peerStates }
      delete updated[pubkey]
      set({ peerStates: updated })
    } else {
      set({ peerStates: { ...peerStates, [pubkey]: state } })
    }
  },

  /**
   * Räumt sämtliche selbstlöschenden Nachrichten weg, deren expiresAt
   * in der Vergangenheit liegt. Wird vom `useEphemeralCleanup`-Hook
   * jede Sekunde aufgerufen.
   *
   * Schreibt nur dann zurück in den Store, wenn sich tatsächlich was
   * geändert hat — sonst würde jede Sekunde ein Re-Render der gesamten
   * Chat-Liste ausgelöst.
   */
  removeExpiredMessages: () => {
    const { messages } = get()
    const now = Date.now()
    let changed = false
    const updated: Record<string, Message[]> = {}

    for (const [chatId, msgs] of Object.entries(messages)) {
      const filtered = msgs.filter(m => !m.expiresAt || m.expiresAt > now)
      if (filtered.length !== msgs.length) changed = true
      updated[chatId] = filtered
    }

    if (changed) {
      storage.saveMessages(updated)
      set({ messages: updated })
    }
  },

  // Language (non-sensitive — stays unencrypted in localStorage)
  lang: (localStorage.getItem('rc-lang') as Lang) || 'en',
  setLang: (lang) => { localStorage.setItem('rc-lang', lang); set({ lang }) },

  // Auto-translate
  autoTranslate: localStorage.getItem('alina-autotranslate') === 'true',
  setAutoTranslate: (v) => { localStorage.setItem('alina-autotranslate', String(v)); set({ autoTranslate: v }) },
  allowExternalTranslation: localStorage.getItem('alina-allow-external-translate') === 'true',
  setAllowExternalTranslation: (v) => { localStorage.setItem('alina-allow-external-translate', String(v)); set({ allowExternalTranslation: v }) },
  // Default ON (matches previous always-vibrate behaviour); user can disable
  vibrateOnIncoming: localStorage.getItem('rc-vibrate') !== 'false',
  setVibrateOnIncoming: (v) => { localStorage.setItem('rc-vibrate', String(v)); set({ vibrateOnIncoming: v }) },
  updateMessageStatus: (chatId, ts, pubkey, status) => {
    const { messages } = get()
    const msgs = messages[chatId]
    if (!msgs) return
    const idx = msgs.findIndex(m => m.ts === ts && m.pubkey === pubkey)
    const target = msgs[idx]
    if (!target) return
    const updated = [...msgs]
    updated[idx] = { ...target, status }
    const newMessages = { ...messages, [chatId]: updated }
    storage.saveMessages(newMessages)
    set({ messages: newMessages })
  },

  setMessageTranslation: (chatId, ts, pubkey, translated, detectedLang) => {
    const { messages } = get()
    const msgs = messages[chatId]
    if (!msgs) return
    const idx = msgs.findIndex(m => m.ts === ts && m.pubkey === pubkey)
    const target = msgs[idx]
    if (!target) return
    const updated = [...msgs]
    updated[idx] = { ...target, translated, detectedLang }
    const newMessages = { ...messages, [chatId]: updated }
    storage.saveMessages(newMessages)
    set({ messages: newMessages })
  },

  // UI
  openModal: null,
  setOpenModal: (id) => set({ openModal: id }),

  statusMessage: null,
  statusTimeout: null,

  /**
   * Zeigt eine kurze Statusmeldung am unteren Bildschirmrand.
   * Mit `duration` (ms) verschwindet die Meldung automatisch nach der
   * Zeit; ohne `duration` bleibt sie stehen, bis `hideStatus` gerufen
   * wird (für Loading-Zustände wie "Standort wird ermittelt …").
   */
  showStatus: (msg, duration) => {
    const { statusTimeout } = get()
    if (statusTimeout) clearTimeout(statusTimeout)
    if (duration) {
      const timeout = setTimeout(() => {
        set({ statusMessage: null, statusTimeout: null })
      }, duration)
      set({ statusMessage: msg, statusTimeout: timeout })
    } else {
      set({ statusMessage: msg, statusTimeout: null })
    }
  },

  hideStatus: () => {
    const { statusTimeout } = get()
    if (statusTimeout) clearTimeout(statusTimeout)
    set({ statusMessage: null, statusTimeout: null })
  },

  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}))
