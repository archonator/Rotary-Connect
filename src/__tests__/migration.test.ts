import { describe, it, expect } from 'vitest'
import {
  createKeyPair,
  createCrossSignature,
  createMigrationEvent,
  verifyMigrationEvent,
} from '../lib/crypto'

describe('key migration', () => {
  it('verifies a well-formed migration event', () => {
    const oldKey = createKeyPair()
    const newKey = createKeyPair()

    const crossSig = createCrossSignature(newKey.privkey, oldKey.pubkey)
    const event = createMigrationEvent(oldKey.privkey, newKey.pubkey, crossSig)

    const result = verifyMigrationEvent(event)
    expect(result).not.toBeNull()
    expect(result!.valid).toBe(true)
    expect(result!.oldPubkey).toBe(oldKey.pubkey)
    expect(result!.newPubkey).toBe(newKey.pubkey)
  })

  it('rejects an event with the wrong kind', () => {
    const oldKey = createKeyPair()
    const newKey = createKeyPair()
    const crossSig = createCrossSignature(newKey.privkey, oldKey.pubkey)
    const event = createMigrationEvent(oldKey.privkey, newKey.pubkey, crossSig)

    expect(verifyMigrationEvent({ ...event, kind: 4 })).toBeNull()
  })

  it('rejects when the cross-signature was made by a different key', () => {
    const oldKey = createKeyPair()
    const newKey = createKeyPair()
    const attacker = createKeyPair()

    // Attacker forges a cross-sig for a key they don't control
    const crossSig = createCrossSignature(attacker.privkey, oldKey.pubkey)
    const event = createMigrationEvent(oldKey.privkey, newKey.pubkey, crossSig)

    expect(verifyMigrationEvent(event)).toBeNull()
  })

  it('rejects when the cross-signature points at the wrong old pubkey', () => {
    const oldKey = createKeyPair()
    const wrongOld = createKeyPair()
    const newKey = createKeyPair()

    const crossSig = createCrossSignature(newKey.privkey, wrongOld.pubkey)
    const event = createMigrationEvent(oldKey.privkey, newKey.pubkey, crossSig)

    expect(verifyMigrationEvent(event)).toBeNull()
  })
})
