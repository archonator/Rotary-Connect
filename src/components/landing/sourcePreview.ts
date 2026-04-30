// Curated excerpt of the core Nostr / NIP-04 / NIP-17 logic shown on the landing page.
// Kept in sync (best-effort) with src/lib/nostr.ts and src/lib/crypto.ts.

export const SOURCE_PREVIEW = `// ──────────────────────────────────────────────
// Rotary Connect — decentralised messenger
// © 2026 Kay (__archon) Muehlenbruch
// MIT License — https://opensource.org/licenses/MIT
// Protocol: Nostr (nostr-tools v2)
// Encryption: NIP-04 (DMs) + NIP-17 (group rooms)
// No server. No account. No owner.
// ──────────────────────────────────────────────

import { nip04, nip44, generateSecretKey, getPublicKey,
         finalizeEvent, verifyEvent } from 'nostr-tools'

// ── Default relay set ──────────────────────────────

export const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://nostr.mom',
  'wss://nostr.wine',
  'wss://purplepag.es',
  'wss://relay.primal.net',
  'wss://relay.nostr.bg',
] as const

// ── Encrypted DM (NIP-04) ──────────────────────────

export async function publishDM(
  privkey: Uint8Array,
  myPubkey: string,
  recipientPubkey: string,
  msgData: { type: string; content: string },
): Promise<void> {
  // Try direct WebRTC first; fall back to relay if no peer
  if (isPeerConnected(recipientPubkey)) {
    if (sendViaPeer(recipientPubkey, msgData)) return
  }

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

// ── Group room (NIP-17 Seal + Gift Wrap) ───────────

export async function publishRoomMessage(
  privkey: Uint8Array,
  myPubkey: string,
  roomHash: string,
  msgData: { type: string; content: string; name: string },
): Promise<void> {
  const rumor = {
    kind: 14,
    pubkey: myPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['e', roomHash, '', 'root']],
    content: JSON.stringify(msgData),
  }

  // Per-recipient: Seal (kind 13) → Gift Wrap (kind 1059, ephemeral key)
  for (const memberPubkey of room.members) {
    if (memberPubkey === myPubkey) continue
    const seal = createSeal(privkey, memberPubkey, rumor)
    const giftWrap = createGiftWrap(memberPubkey, seal)
    publishToRelays(giftWrap)
  }
  publishRoomPresence(privkey, myPubkey, roomHash, msgData.name)
}

// ── Identity ───────────────────────────────────────

export function createKeyPair() {
  const privkey = generateSecretKey()
  const pubkey = getPublicKey(privkey)
  return { privkey, pubkey }
}

// ── Room hashing ───────────────────────────────────

export async function hashRoomName(name: string): Promise<string> {
  const data = new TextEncoder().encode('alina-room-v1:' + name.toLowerCase())
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── Local-data vault (AES-256-GCM) ─────────────────

export async function initVault(pin: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const kek  = await deriveKEK(pin, salt)            // PBKDF2-600k
  const dek  = crypto.getRandomValues(new Uint8Array(32))
  const wrappedDEK = await encryptRaw(kek, dek)
  // DEK is held as a non-extractable WebCrypto key in memory
  dataKey = await crypto.subtle.importKey(
    'raw', dek, { name: 'AES-GCM', length: 256 },
    false, ['encrypt', 'decrypt'],
  )
  dek.fill(0)
  localStorage.setItem('alina_vault_salt', toBase64(salt))
  localStorage.setItem('alina_vault_dek',  wrappedDEK)
}`
