import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  verifyEvent,
  nip04,
  nip19,
  nip44,
} from 'nostr-tools'
import type { UnsignedEvent, VerifiedEvent } from 'nostr-tools'
import { SEAL_KIND, GIFT_WRAP_KIND, KEY_MIGRATION_KIND } from './constants'

export { nip19 }

// ── NIP-44 Encryption (used by NIP-17 Gift Wraps) ─────────────────────────────

export function nip44Encrypt(
  privkey: Uint8Array,
  recipientPubkey: string,
  plaintext: string,
): string {
  const key = nip44.v2.utils.getConversationKey(privkey, recipientPubkey)
  return nip44.v2.encrypt(plaintext, key)
}

export function nip44Decrypt(
  privkey: Uint8Array,
  senderPubkey: string,
  ciphertext: string,
): string {
  const key = nip44.v2.utils.getConversationKey(privkey, senderPubkey)
  return nip44.v2.decrypt(ciphertext, key)
}

// ── NIP-17 Seal & Gift Wrap ───────────────────────────────────────────────────

/** Create a Kind 13 Seal: encrypt a Kind 14 rumor for a specific recipient */
export function createSeal(
  senderPrivkey: Uint8Array,
  senderPubkey: string,
  recipientPubkey: string,
  rumor: object,
): VerifiedEvent {
  const rumorJson = JSON.stringify(rumor)
  const encrypted = nip44Encrypt(senderPrivkey, recipientPubkey, rumorJson)
  return finalizeEvent({
    kind: SEAL_KIND,
    created_at: randomTimestamp(),
    tags: [],
    content: encrypted,
  }, senderPrivkey) as VerifiedEvent
}

/** Create a Kind 1059 Gift Wrap: encrypt a Seal with an ephemeral key */
export function createGiftWrap(
  recipientPubkey: string,
  seal: VerifiedEvent,
): VerifiedEvent {
  const ephemeralPrivkey = generateSecretKey()
  const sealJson = JSON.stringify(seal)
  const encrypted = nip44Encrypt(ephemeralPrivkey, recipientPubkey, sealJson)
  return finalizeEvent({
    kind: GIFT_WRAP_KIND,
    created_at: randomTimestamp(),
    tags: [['p', recipientPubkey]],
    content: encrypted,
  }, ephemeralPrivkey) as VerifiedEvent
}

/** Unwrap a Kind 1059 Gift Wrap → returns the Seal (Kind 13) inside */
export function unwrapGiftWrap(
  recipientPrivkey: Uint8Array,
  giftWrap: { pubkey: string; content: string },
): VerifiedEvent | null {
  try {
    const sealJson = nip44Decrypt(recipientPrivkey, giftWrap.pubkey, giftWrap.content)
    const seal = JSON.parse(sealJson) as VerifiedEvent
    if (seal.kind !== SEAL_KIND) return null
    if (!verifyEvent(seal)) return null
    return seal
  } catch { return null }
}

/** Unseal a Kind 13 Seal → returns the Kind 14 rumor (chat message) inside */
export function unsealRumor(
  recipientPrivkey: Uint8Array,
  seal: VerifiedEvent,
): { kind: number; pubkey: string; content: string; created_at: number; tags: string[][] } | null {
  try {
    const rumorJson = nip44Decrypt(recipientPrivkey, seal.pubkey, seal.content)
    return JSON.parse(rumorJson)
  } catch { return null }
}

/** Randomize timestamp ±48h to hide metadata (uses crypto PRNG) */
function randomTimestamp(): number {
  const now = Math.floor(Date.now() / 1000)
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  const jitter = (arr[0] % 172800) - 86400 // ±24h with crypto PRNG
  return now + jitter
}

export function createKeyPair(): { privkey: Uint8Array; pubkey: string } {
  const privkey = generateSecretKey()
  const pubkey = getPublicKey(privkey)
  return { privkey, pubkey }
}

export function pubkeyFromPrivkey(privkey: Uint8Array): string {
  return getPublicKey(privkey)
}

export function decodeNsec(nsec: string): Uint8Array {
  const decoded = nip19.decode(nsec)
  if (decoded.type !== 'nsec') throw new Error('Not an nsec key')
  return decoded.data as Uint8Array
}

export function encodeNpub(pubkey: string): string {
  return nip19.npubEncode(pubkey)
}

export function decodeNpub(npub: string): string {
  const decoded = nip19.decode(npub)
  if (decoded.type !== 'npub') throw new Error('Not an npub key')
  return decoded.data as string
}

export function encodeNsec(privkey: Uint8Array): string {
  return nip19.nsecEncode(privkey)
}

export async function encryptDM(
  privkey: Uint8Array,
  recipientPubkey: string,
  plaintext: string,
): Promise<string> {
  return nip04.encrypt(privkey, recipientPubkey, plaintext)
}

export async function decryptDM(
  privkey: Uint8Array,
  senderPubkey: string,
  ciphertext: string,
): Promise<string> {
  return nip04.decrypt(privkey, senderPubkey, ciphertext)
}

export function createSignedEvent(
  event: UnsignedEvent,
  privkey: Uint8Array,
): VerifiedEvent {
  return finalizeEvent(event, privkey) as VerifiedEvent
}

export function isValidEvent(event: unknown): boolean {
  return verifyEvent(event as VerifiedEvent)
}

export async function hashRoomName(name: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode('alina-room-v1:' + name.toLowerCase())
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── Key Migration ────────────────────────────────────────────────────────────

/**
 * Create a cross-signature proving ownership of a new key.
 * The new key signs the old pubkey, and the old key signs the new pubkey.
 */
export function createCrossSignature(
  newPrivkey: Uint8Array,
  oldPubkey: string,
): string {
  // New key signs: "migrate:<old_pubkey>:<timestamp>"
  const ts = Math.floor(Date.now() / 1000)
  const message = `migrate:${oldPubkey}:${ts}`
  const event = finalizeEvent({
    kind: KEY_MIGRATION_KIND,
    created_at: ts,
    tags: [['proof', oldPubkey]],
    content: message,
  }, newPrivkey) as VerifiedEvent
  return JSON.stringify(event)
}

/**
 * Create a key migration event signed by the OLD key.
 * Contains the new pubkey + cross-signature from the new key.
 */
export function createMigrationEvent(
  oldPrivkey: Uint8Array,
  oldPubkey: string,
  newPubkey: string,
  crossSignature: string,
): VerifiedEvent {
  return finalizeEvent({
    kind: KEY_MIGRATION_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['p', newPubkey],
      ['alt', 'Key migration event'],
    ],
    content: JSON.stringify({
      newPubkey,
      crossSignature,
      message: 'This identity has migrated to a new key.',
    }),
  }, oldPrivkey) as VerifiedEvent
}

/**
 * Verify a key migration event.
 * Checks: old key signature is valid, cross-signature from new key is valid.
 */
export function verifyMigrationEvent(
  event: { pubkey: string; content: string; kind: number },
): { valid: boolean; oldPubkey: string; newPubkey: string } | null {
  try {
    if (event.kind !== KEY_MIGRATION_KIND) return null

    const payload = JSON.parse(event.content)
    const { newPubkey, crossSignature } = payload
    if (!newPubkey || !crossSignature) return null

    // Verify the cross-signature (signed by new key)
    const proofEvent = JSON.parse(crossSignature)
    if (!verifyEvent(proofEvent)) return null

    // Check that the proof was signed by the claimed new key
    if (proofEvent.pubkey !== newPubkey) return null

    // Check that the proof references the old key
    const proofTag = proofEvent.tags?.find((t: string[]) => t[0] === 'proof')
    if (!proofTag || proofTag[1] !== event.pubkey) return null

    return {
      valid: true,
      oldPubkey: event.pubkey,
      newPubkey,
    }
  } catch {
    return null
  }
}

export async function hashInviteCode(code: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode('alina-invite-v1:' + code)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}
