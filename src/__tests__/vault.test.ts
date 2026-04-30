import { describe, it, expect, beforeEach } from 'vitest'
import {
  isVaultActive,
  isVaultUnlocked,
  isEncrypted,
  initVault,
  unlockVault,
  lockVault,
  vaultEncrypt,
  vaultDecrypt,
  changeVaultPin,
  destroyVault,
  ENCRYPTED_PREFIX,
} from '../lib/vault'

beforeEach(() => {
  localStorage.clear()
  lockVault()
})

describe('vault', () => {
  it('is inactive on a fresh device', () => {
    expect(isVaultActive()).toBe(false)
    expect(isVaultUnlocked()).toBe(false)
  })

  it('initVault creates a vault and unlocks it', async () => {
    await initVault('1357')
    expect(isVaultActive()).toBe(true)
    expect(isVaultUnlocked()).toBe(true)
  })

  it('encrypts strings with the vault prefix', async () => {
    await initVault('1357')
    const ct = await vaultEncrypt('hello')
    expect(ct.startsWith(ENCRYPTED_PREFIX)).toBe(true)
    expect(isEncrypted(ct)).toBe(true)
    expect(ct).not.toContain('hello')
  })

  it('decrypts back to the original plaintext', async () => {
    await initVault('1357')
    const ct = await vaultEncrypt('Hello, vault! 🔐 Привет!')
    const pt = await vaultDecrypt(ct)
    expect(pt).toBe('Hello, vault! 🔐 Привет!')
  })

  it('produces different ciphertext for the same plaintext (random IV)', async () => {
    await initVault('1357')
    const a = await vaultEncrypt('same')
    const b = await vaultEncrypt('same')
    expect(a).not.toBe(b)
  })

  it('passes plaintext through vaultDecrypt unchanged', async () => {
    await initVault('1357')
    expect(await vaultDecrypt('not-encrypted')).toBe('not-encrypted')
  })

  it('unlockVault accepts the correct PIN', async () => {
    await initVault('1357')
    lockVault()
    expect(isVaultUnlocked()).toBe(false)
    expect(await unlockVault('1357')).toBe(true)
    expect(isVaultUnlocked()).toBe(true)
  })

  it('unlockVault rejects a wrong PIN', async () => {
    await initVault('1357')
    lockVault()
    expect(await unlockVault('9999')).toBe(false)
    expect(isVaultUnlocked()).toBe(false)
  })

  it('changeVaultPin re-wraps the DEK without re-encrypting data', async () => {
    await initVault('1357')
    const ct = await vaultEncrypt('payload')
    expect(await changeVaultPin('1357', '2468')).toBe(true)
    // Existing ciphertext still decryptable with same DEK
    expect(await vaultDecrypt(ct)).toBe('payload')
    // Old PIN no longer works
    lockVault()
    expect(await unlockVault('1357')).toBe(false)
    expect(await unlockVault('2468')).toBe(true)
  })

  it('changeVaultPin rejects a wrong old PIN', async () => {
    await initVault('1357')
    expect(await changeVaultPin('0000', '2468')).toBe(false)
  })

  it('destroyVault wipes all vault state', async () => {
    await initVault('1357')
    destroyVault()
    expect(isVaultActive()).toBe(false)
    expect(isVaultUnlocked()).toBe(false)
  })

  it('vaultEncrypt throws when locked', async () => {
    await expect(vaultEncrypt('x')).rejects.toThrow()
  })
})
