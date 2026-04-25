// Source code preview shown on the landing page
// This is a curated excerpt of the core Nostr logic

export const SOURCE_PREVIEW = `// ──────────────────────────────────────────────
// Alina — decentralised messenger
// © 2026 Kay (__archon) Muehlenbruch
// MIT License — https://opensource.org/licenses/MIT
// Protocol: Nostr (nostr-tools v2)
// Encryption: NIP-04 (ECDH + AES)
// No server. No account. No owner.
// ──────────────────────────────────────────────

import { nip04, nip19, generateSecretKey, getPublicKey,
         finalizeEvent, verifyEvent } from 'nostr-tools'

// ── Relay connections ──

const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://nostr.mom',
  'wss://nostr.wine',
  'wss://purplepag.es',
  'wss://relay.primal.net',
  'wss://relay.nostr.bg',
]

export function connectAllRelays(): void {
  RELAYS.forEach(url => {
    const ws = new WebSocket(url)
    ws.onopen = () => {
      relays.push({ url, ws })
      subscribeAll(ws)
    }
    ws.onmessage = (e) => handleRelayMessage(e.data)
    ws.onclose = () => {
      relays = relays.filter(r => r.url !== url)
      setTimeout(() => connectRelay(url), 15000)
    }
  })
}

// ── Send encrypted DM (NIP-04) ──

export async function publishDM(
  privkey: Uint8Array,
  myPubkey: string,
  recipientPubkey: string,
  msgData: { type: string; content: string },
): Promise<void> {
  const payload = JSON.stringify(msgData)
  const encrypted = await nip04.encrypt(privkey, recipientPubkey, payload)
  const event = finalizeEvent({
    kind: 4,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', recipientPubkey]],
    content: encrypted,
    pubkey: myPubkey,
  }, privkey)
  publishToRelays(event)
}

// ── Decrypt incoming DM ──

async function handleDM(event): Promise<void> {
  const fromPubkey = event.pubkey
  if (fromPubkey === myPubkey) return

  const decrypted = await nip04.decrypt(privkey, fromPubkey, event.content)
  const parsed = JSON.parse(decrypted)
  const msg = {
    type: parsed.type || 'text',
    content: parsed.content,
    pubkey: fromPubkey,
    ts: event.created_at * 1000,
  }
  addMessage('dm:' + fromPubkey, msg)
}

// ── Identity ──

export function createKeyPair() {
  const privkey = generateSecretKey()
  const pubkey = getPublicKey(privkey)
  return { privkey, pubkey }
}

// ── Room (kind 42) ──

export async function hashRoomName(name: string): Promise<string> {
  const data = new TextEncoder().encode('alina-room-v1:' + name.toLowerCase())
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── State (Zustand) ──

export const useStore = create((set, get) => ({
  identity: loadIdentity(),
  contacts: loadContacts(),
  rooms: loadRooms(),
  messages: loadMessages(),
  activeChat: null,

  createIdentity: (name) => {
    const { privkey, pubkey } = createKeyPair()
    saveIdentity({ privkey, pubkey, name })
    set({ identity: { privkey, pubkey, name } })
  },

  addMessage: (chatId, msg) => {
    const existing = get().messages[chatId] || []
    if (existing.find(m => m.ts === msg.ts && m.pubkey === msg.pubkey))
      return false // deduplicate
    const updated = [...existing, msg].slice(-200)
    saveMessages({ ...get().messages, [chatId]: updated })
    set({ messages: { ...get().messages, [chatId]: updated } })
    return true
  },
}))`
