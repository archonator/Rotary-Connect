import { create } from 'zustand'
import * as storage from '../lib/storage'
import { createKeyPair, pubkeyFromPrivkey, decodeNsec, decodeNpub } from '../lib/crypto'
import { MAX_MESSAGES_PER_CHAT } from '../lib/constants'
import type { Lang } from '../lib/i18n'
import type { PeerState } from '../lib/webrtc/types'

export interface Identity {
  privkey: Uint8Array
  pubkey: string
  name: string
}

export interface Contact {
  pubkey: string
  name: string
}

export interface Room {
  name: string
  hash: string
  members: string[] // pubkeys of known group members
}

export interface Message {
  type: 'text' | 'image' | 'location'
  content: string
  pubkey: string
  name?: string
  ts: number
  eventId?: string
  translated?: string
  detectedLang?: string
  ttl?: number        // time-to-live in seconds (e.g. 30, 300, 3600)
  expiresAt?: number  // absolute timestamp (ms) when the message should vanish
  status?: 'sending' | 'sent' | 'failed' // delivery status for own messages
}

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
   * Hydrate store from decrypted storage cache.
   * Call after vault unlock + loadDecryptedCache().
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

  migrateContact: (oldPubkey, newPubkey) => {
    if (oldPubkey === newPubkey) return
    const { contacts, messages, unread, activeChat } = get()
    const oldContact = contacts[oldPubkey]
    if (!oldContact) return

    // Move contact entry
    const updatedContacts = { ...contacts }
    delete updatedContacts[oldPubkey]
    updatedContacts[newPubkey] = { ...oldContact, pubkey: newPubkey }

    // Move chat history under the new chatId
    const oldChatId = 'dm:' + oldPubkey
    const newChatId = 'dm:' + newPubkey
    const updatedMessages: Record<string, Message[]> = { ...messages }
    if (updatedMessages[oldChatId]) {
      const carried = (updatedMessages[oldChatId] || []).map(m =>
        m.pubkey === oldPubkey ? { ...m, pubkey: newPubkey } : m,
      )
      updatedMessages[newChatId] = [...(updatedMessages[newChatId] || []), ...carried]
      delete updatedMessages[oldChatId]
    }

    // Carry unread + active chat
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

  addRoom: (hash, name) => {
    const { rooms, identity } = get()
    const members = identity ? [identity.pubkey] : []
    const existing = rooms[hash]
    const updated = { ...rooms, [hash]: { name, hash, members: existing?.members ?? members } }
    storage.saveRooms(updated)
    set({ rooms: updated })
  },

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

  addMessage: (chatId, msg) => {
    const { messages } = get()
    const existing = messages[chatId] || []
    // Deduplicate — prefer eventId (unique), fall back to ts+pubkey for local messages
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

  // Ephemeral messages — remove all expired messages across all chats
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
    if (idx === -1) return
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
    if (idx === -1) return
    const updated = [...msgs]
    updated[idx] = { ...updated[idx], translated, detectedLang }
    const newMessages = { ...messages, [chatId]: updated }
    storage.saveMessages(newMessages)
    set({ messages: newMessages })
  },

  // UI
  openModal: null,
  setOpenModal: (id) => set({ openModal: id }),

  statusMessage: null,
  statusTimeout: null,

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
