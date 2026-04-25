import { describe, it, expect } from 'vitest'
import {
  createKeyPair,
  pubkeyFromPrivkey,
  encodeNsec,
  decodeNsec,
  encodeNpub,
  decodeNpub,
  encryptDM,
  decryptDM,
  hashRoomName,
  hashInviteCode,
} from '../lib/crypto'

describe('crypto', () => {
  describe('createKeyPair', () => {
    it('should generate a valid keypair', () => {
      const { privkey, pubkey } = createKeyPair()
      expect(privkey).toBeInstanceOf(Uint8Array)
      expect(privkey.length).toBe(32)
      expect(pubkey).toMatch(/^[0-9a-f]{64}$/)
    })

    it('should generate unique keypairs each time', () => {
      const kp1 = createKeyPair()
      const kp2 = createKeyPair()
      expect(kp1.pubkey).not.toBe(kp2.pubkey)
    })
  })

  describe('pubkeyFromPrivkey', () => {
    it('should derive the correct pubkey', () => {
      const { privkey, pubkey } = createKeyPair()
      expect(pubkeyFromPrivkey(privkey)).toBe(pubkey)
    })
  })

  describe('nsec encoding/decoding', () => {
    it('should round-trip nsec encode/decode', () => {
      const { privkey } = createKeyPair()
      const nsec = encodeNsec(privkey)
      expect(nsec).toMatch(/^nsec1/)
      const decoded = decodeNsec(nsec)
      expect(Array.from(decoded)).toEqual(Array.from(privkey))
    })

    it('should reject invalid nsec', () => {
      expect(() => decodeNsec('not-a-valid-nsec')).toThrow()
    })
  })

  describe('npub encoding/decoding', () => {
    it('should round-trip npub encode/decode', () => {
      const { pubkey } = createKeyPair()
      const npub = encodeNpub(pubkey)
      expect(npub).toMatch(/^npub1/)
      expect(decodeNpub(npub)).toBe(pubkey)
    })
  })

  describe('DM encryption/decryption', () => {
    it('should encrypt and decrypt a message between two keypairs', async () => {
      const alice = createKeyPair()
      const bob = createKeyPair()

      const plaintext = 'Hello, Bob! This is a secret message.'
      const encrypted = await encryptDM(alice.privkey, bob.pubkey, plaintext)
      expect(encrypted).not.toBe(plaintext)
      expect(encrypted).toContain('?iv=')

      const decrypted = await decryptDM(bob.privkey, alice.pubkey, encrypted)
      expect(decrypted).toBe(plaintext)
    })

    it('should handle unicode messages', async () => {
      const alice = createKeyPair()
      const bob = createKeyPair()
      const msg = 'Привет! 你好! こんにちは! 🎉'

      const encrypted = await encryptDM(alice.privkey, bob.pubkey, msg)
      const decrypted = await decryptDM(bob.privkey, alice.pubkey, encrypted)
      expect(decrypted).toBe(msg)
    })
  })

  describe('hashing', () => {
    it('should produce deterministic room hashes', async () => {
      const hash1 = await hashRoomName('TestRoom')
      const hash2 = await hashRoomName('testroom') // case-insensitive
      expect(hash1).toBe(hash2)
      expect(hash1).toMatch(/^[0-9a-f]{64}$/)
    })

    it('should produce different hashes for different rooms', async () => {
      const hash1 = await hashRoomName('Room1')
      const hash2 = await hashRoomName('Room2')
      expect(hash1).not.toBe(hash2)
    })

    it('should produce deterministic invite code hashes', async () => {
      const hash1 = await hashInviteCode('123456')
      const hash2 = await hashInviteCode('123456')
      expect(hash1).toBe(hash2)
      expect(hash1).toMatch(/^[0-9a-f]{64}$/)
    })
  })
})
