/**
 * Vault — Two-layer AES-256-GCM encryption for localStorage
 *
 * Architecture:
 *   PIN  ->  PBKDF2 (600k iterations)  ->  KEK (Key Encryption Key)
 *   KEK  encrypts  ->  DEK (Data Encryption Key, random 256-bit)
 *   DEK  encrypts  ->  all sensitive localStorage data
 *
 * The DEK is imported as a **non-extractable** CryptoKey.
 * Even with XSS, an attacker cannot read the DEK — only use it
 * while the vault is open in the current browser context.
 *
 * PIN change only re-wraps the DEK with a new KEK.
 * No data re-encryption needed.
 */

const VAULT_SALT = 'alina_vault_salt'
const VAULT_DEK = 'alina_vault_dek'
const VAULT_VERIFY = 'alina_vault_verify'
const PBKDF2_ITERATIONS = 600_000

/** Prefix for all vault-encrypted values in localStorage */
export const ENCRYPTED_PREFIX = 'v1:'

let dataKey: CryptoKey | null = null

// ── Helpers ──────────────────────────────────────────────────────

function toBase64(arr: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i])
  return btoa(bin)
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}

// ── Internal Crypto ──────────────────────────────────────────────

async function deriveKEK(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function encryptRaw(key: CryptoKey, data: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
  return toBase64(iv) + '.' + toBase64(new Uint8Array(cipher))
}

async function decryptRaw(key: CryptoKey, encoded: string): Promise<Uint8Array> {
  const dot = encoded.indexOf('.')
  if (dot === -1) throw new Error('Invalid ciphertext format')
  const iv = fromBase64(encoded.slice(0, dot))
  const cipher = fromBase64(encoded.slice(dot + 1))
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher)
  return new Uint8Array(plain)
}

// ── Public API ───────────────────────────────────────────────────

/** Check if an encrypted vault exists in localStorage */
export function isVaultActive(): boolean {
  return !!localStorage.getItem(VAULT_SALT)
}

/** Check if the vault is currently unlocked (DEK in memory) */
export function isVaultUnlocked(): boolean {
  return dataKey !== null
}

/** Check if a stored value is vault-encrypted */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX)
}

/**
 * Create a new vault with the given PIN.
 * Generates a random DEK, wraps it with a PIN-derived KEK,
 * and stores salt + encrypted DEK + verification token.
 */
export async function initVault(pin: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const kek = await deriveKEK(pin, salt)

  // Generate random DEK
  const dekBytes = crypto.getRandomValues(new Uint8Array(32))

  // Encrypt DEK with KEK
  const encryptedDEK = await encryptRaw(kek, dekBytes)

  // Import DEK as non-extractable CryptoKey
  dataKey = await crypto.subtle.importKey(
    'raw',
    dekBytes,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt'],
  )

  // Zero out raw DEK bytes
  dekBytes.fill(0)

  // Persist salt + encrypted DEK
  localStorage.setItem(VAULT_SALT, toBase64(salt))
  localStorage.setItem(VAULT_DEK, encryptedDEK)

  // Store encrypted verification token (proves correct PIN on unlock)
  const verify = await vaultEncrypt('alina-vault-ok')
  localStorage.setItem(VAULT_VERIFY, verify)
}

/**
 * Attempt to unlock the vault with a PIN.
 * Returns true if the PIN is correct.
 */
export async function unlockVault(pin: string): Promise<boolean> {
  const saltB64 = localStorage.getItem(VAULT_SALT)
  const encDEK = localStorage.getItem(VAULT_DEK)
  const verifyStored = localStorage.getItem(VAULT_VERIFY)
  if (!saltB64 || !encDEK || !verifyStored) return false

  try {
    const salt = fromBase64(saltB64)
    const kek = await deriveKEK(pin, salt)

    // Decrypt DEK with KEK
    const dekBytes = await decryptRaw(kek, encDEK)

    // Import DEK as non-extractable CryptoKey
    const candidateKey = await crypto.subtle.importKey(
      'raw',
      dekBytes,
      { name: 'AES-GCM', length: 256 },
      false, // non-extractable
      ['encrypt', 'decrypt'],
    )

    // Zero out raw bytes
    dekBytes.fill(0)

    // Verify by decrypting the stored verification token
    if (!verifyStored.startsWith(ENCRYPTED_PREFIX)) return false
    const verifyRaw = verifyStored.slice(ENCRYPTED_PREFIX.length)
    const verifyBytes = await decryptRaw(candidateKey, verifyRaw)
    const verifyText = new TextDecoder().decode(verifyBytes)

    if (verifyText !== 'alina-vault-ok') return false

    dataKey = candidateKey
    return true
  } catch {
    return false // Wrong PIN -> AES-GCM auth tag mismatch
  }
}

/** Lock the vault — wipe DEK from memory */
export function lockVault(): void {
  dataKey = null
}

/** Encrypt a plaintext string. Returns prefixed ciphertext. */
export async function vaultEncrypt(plaintext: string): Promise<string> {
  if (!dataKey) throw new Error('Vault is locked')
  const encoded = new TextEncoder().encode(plaintext)
  const raw = await encryptRaw(dataKey, encoded)
  return ENCRYPTED_PREFIX + raw
}

/** Decrypt a vault-encrypted string. Passes through plaintext unchanged. */
export async function vaultDecrypt(ciphertext: string): Promise<string> {
  if (!dataKey) throw new Error('Vault is locked')
  if (!ciphertext.startsWith(ENCRYPTED_PREFIX)) {
    return ciphertext // Plaintext (pre-migration data)
  }
  const raw = ciphertext.slice(ENCRYPTED_PREFIX.length)
  const plainBytes = await decryptRaw(dataKey, raw)
  return new TextDecoder().decode(plainBytes)
}

/**
 * Change the vault PIN without re-encrypting data.
 * Decrypts DEK with old KEK, re-encrypts with new KEK.
 */
export async function changeVaultPin(oldPin: string, newPin: string): Promise<boolean> {
  const saltB64 = localStorage.getItem(VAULT_SALT)
  const encDEK = localStorage.getItem(VAULT_DEK)
  if (!saltB64 || !encDEK) return false

  try {
    // Decrypt DEK with old KEK
    const oldSalt = fromBase64(saltB64)
    const oldKEK = await deriveKEK(oldPin, oldSalt)
    const dekBytes = await decryptRaw(oldKEK, encDEK)

    // Create new KEK from new PIN
    const newSalt = crypto.getRandomValues(new Uint8Array(32))
    const newKEK = await deriveKEK(newPin, newSalt)

    // Re-encrypt DEK with new KEK
    const newEncDEK = await encryptRaw(newKEK, dekBytes)

    // Re-import DEK as non-extractable
    dataKey = await crypto.subtle.importKey(
      'raw',
      dekBytes,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )

    // Zero out raw bytes
    dekBytes.fill(0)

    // Store new salt + encrypted DEK
    localStorage.setItem(VAULT_SALT, toBase64(newSalt))
    localStorage.setItem(VAULT_DEK, newEncDEK)

    // Re-encrypt verification token with new DEK (same DEK, but new IV)
    const verify = await vaultEncrypt('alina-vault-ok')
    localStorage.setItem(VAULT_VERIFY, verify)

    return true
  } catch {
    return false
  }
}

/** Destroy the vault completely (used on logout) */
export function destroyVault(): void {
  dataKey = null
  localStorage.removeItem(VAULT_SALT)
  localStorage.removeItem(VAULT_DEK)
  localStorage.removeItem(VAULT_VERIFY)
}
