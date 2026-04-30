/**
 * Vault — lokale "at-rest"-Verschlüsselung für sensible localStorage-Werte.
 *
 * Problemstellung
 * ───────────────
 *   Der private Nostr-Schlüssel und die Chat-History liegen in
 *   localStorage. Wer auch nur kurz Zugriff auf das Gerät hat (oder
 *   ein Add-on / Browser-Plugin mit DOM-Zugriff), könnte sie sonst
 *   einfach auslesen.
 *
 * Lösung: zweistufige Verschlüsselung mit AES-256-GCM
 * ───────────────────────────────────────────────────
 *
 *     PIN  ──┐
 *            ├── PBKDF2 (600 000 Iterationen) ──►  KEK
 *     Salt ──┘                                       │
 *                                                    │ AES-GCM
 *                                                    ▼
 *                                                   DEK  (256-bit, zufällig)
 *                                                    │
 *                                                    │ AES-GCM
 *                                                    ▼
 *                                  jeder einzelne Wert in localStorage
 *
 *   • KEK ("Key Encryption Key") = aus dem PIN abgeleitet. Existiert
 *     nur kurz im Speicher beim Unlock; wird sofort wieder verworfen.
 *   • DEK ("Data Encryption Key") = wird einmal bei Vault-Anlage
 *     gewürfelt, vom KEK eingewickelt persistiert und beim Unlock als
 *     **non-extractable** WebCrypto-Key in den Speicher geladen. Ein
 *     Angreifer mit XSS kann den DEK NICHT auslesen — nur benutzen
 *     solange der Tab offen ist.
 *
 * Konsequenzen
 * ────────────
 *   • PIN-Wechsel = nur den DEK mit neuem KEK neu einwickeln.
 *     Die eigentlichen Daten müssen nicht erneut verschlüsselt werden.
 *   • Vergessener PIN = Daten unwiederbringlich verloren. Es gibt
 *     bewusst keine Backdoor / Recovery — sonst wäre der ganze
 *     Aufwand sinnlos.
 *   • Das Lockout in `PinLock.tsx` (X falsche PINs → Wartezeit) ist
 *     nur eine UI-Hürde. Der eigentliche Schutz ist PBKDF2-600k:
 *     selbst mit modernen GPUs sind 4-stellige PINs in spürbarer Zeit
 *     durchprobierbar, längere PINs (6+ Ziffern oder Wörter) sind
 *     praktisch unangreifbar.
 */

const VAULT_SALT = 'alina_vault_salt'   // localStorage-Key für das Salt
const VAULT_DEK = 'alina_vault_dek'     // localStorage-Key für den eingewickelten DEK
const VAULT_VERIFY = 'alina_vault_verify' // verschlüsselter Verifikationstoken
const PBKDF2_ITERATIONS = 600_000

/**
 * Prefix für alle vault-verschlüsselten Werte. Erlaubt es, ohne
 * Try-Catch zu erkennen, ob ein Wert bereits verschlüsselt ist
 * (vs. einer aus der Plaintext-Vor-Migrations-Phase).
 */
export const ENCRYPTED_PREFIX = 'v1:'

/**
 * Der DEK als WebCrypto-Schlüssel.
 *
 * `null` solange der Vault verschlossen ist. Sobald `unlockVault()`
 * oder `initVault()` durchläuft, hält diese Modul-Variable den
 * importierten Schlüssel — non-extractable, sodass selbst Code mit
 * voller DOM-Hoheit ihn nicht roh exportieren kann, sondern nur
 * `encrypt`/`decrypt` aufrufen.
 */
let dataKey: CryptoKey | null = null

// ── Base64-Hilfsfunktionen ───────────────────────────────────────
//
// IV und Ciphertext werden als Base64 in localStorage abgelegt
// (Strings sind dort robuster als Binärdaten).

function toBase64(arr: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i] as number)
  return btoa(bin)
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}

// ── Interne Krypto-Bausteine ─────────────────────────────────────

/**
 * PBKDF2-Schlüsselableitung: PIN + Salt → KEK.
 *
 * 600 000 Iterationen sind der OWASP-Stand 2023 für PBKDF2-SHA256.
 * Auf einem typischen Smartphone dauert das ~0.5–1 Sekunde — für den
 * User akzeptabel beim Unlock, für einen Brute-Force-Angreifer aber
 * Faktor 600 000 langsamer pro PIN-Versuch.
 */
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
    false, // ← non-extractable
    ['encrypt', 'decrypt'],
  )
}

/**
 * Roh-Verschlüsselung: AES-GCM mit zufälligem 12-Byte-IV.
 * Format `iv.ciphertext`, beides Base64 — der Punkt als Trenner ist
 * kein Standard, reicht aber für den eigenen Use-Case.
 */
async function encryptRaw(key: CryptoKey, data: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
  return toBase64(iv) + '.' + toBase64(new Uint8Array(cipher))
}

/** Spiegelbild zu encryptRaw. Wirft, wenn das Auth-Tag nicht stimmt. */
async function decryptRaw(key: CryptoKey, encoded: string): Promise<Uint8Array> {
  const dot = encoded.indexOf('.')
  if (dot === -1) throw new Error('Invalid ciphertext format')
  const iv = fromBase64(encoded.slice(0, dot))
  const cipher = fromBase64(encoded.slice(dot + 1))
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher)
  return new Uint8Array(plain)
}

// ── Public API ───────────────────────────────────────────────────

/** True, wenn ein Vault auf der Disk liegt (egal ob aktuell entsperrt). */
export function isVaultActive(): boolean {
  return !!localStorage.getItem(VAULT_SALT)
}

/** True, wenn der Vault gerade entsperrt ist (DEK im Speicher). */
export function isVaultUnlocked(): boolean {
  return dataKey !== null
}

/** Heuristik, ob ein gespeicherter String unser Vault-Format hat. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX)
}

/**
 * Legt einen frischen Vault mit dem gegebenen PIN an.
 *
 * Schritte:
 *   1. Zufälliges 32-Byte-Salt würfeln und persistieren.
 *   2. KEK aus PIN + Salt ableiten.
 *   3. DEK würfeln, mit KEK einwickeln und persistieren.
 *   4. DEK als non-extractable WebCrypto-Key in den Speicher importieren.
 *   5. Roh-DEK-Bytes mit Nullen überschreiben (best-effort: JS-GC räumt
 *      hinterher noch auf, aber kein Reststring bleibt im üblichen Pfad).
 *   6. Einen Verifikations-Token verschlüsseln und ablegen, damit man
 *      später beim Unlock einen falschen PIN sauber erkennen kann
 *      (über den AES-GCM-Auth-Tag-Mismatch).
 */
export async function initVault(pin: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const kek = await deriveKEK(pin, salt)

  const dekBytes = crypto.getRandomValues(new Uint8Array(32))
  const encryptedDEK = await encryptRaw(kek, dekBytes)

  dataKey = await crypto.subtle.importKey(
    'raw',
    dekBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )

  dekBytes.fill(0) // Klartext-DEK löschen

  localStorage.setItem(VAULT_SALT, toBase64(salt))
  localStorage.setItem(VAULT_DEK, encryptedDEK)

  const verify = await vaultEncrypt('alina-vault-ok')
  localStorage.setItem(VAULT_VERIFY, verify)
}

/**
 * Versucht, den Vault mit einem PIN zu entsperren.
 *
 * Trick beim Verifikationstoken: wir entschlüsseln einen bekannten
 * String. Wenn das Ergebnis "alina-vault-ok" ist (und das AES-GCM-
 * Auth-Tag stimmt), war der PIN richtig. Bei falschem PIN wirft AES-GCM
 * eine Exception → wir fangen sie ab und liefern `false`.
 */
export async function unlockVault(pin: string): Promise<boolean> {
  const saltB64 = localStorage.getItem(VAULT_SALT)
  const encDEK = localStorage.getItem(VAULT_DEK)
  const verifyStored = localStorage.getItem(VAULT_VERIFY)
  if (!saltB64 || !encDEK || !verifyStored) return false

  try {
    const salt = fromBase64(saltB64)
    const kek = await deriveKEK(pin, salt)

    // DEK aus dem Wrap holen
    const dekBytes = await decryptRaw(kek, encDEK)

    const candidateKey = await crypto.subtle.importKey(
      'raw',
      dekBytes,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )

    dekBytes.fill(0) // Klartext-DEK weg

    // Sanity-Check: Verifikationstoken muss "alina-vault-ok" entschlüsseln
    if (!verifyStored.startsWith(ENCRYPTED_PREFIX)) return false
    const verifyRaw = verifyStored.slice(ENCRYPTED_PREFIX.length)
    const verifyBytes = await decryptRaw(candidateKey, verifyRaw)
    const verifyText = new TextDecoder().decode(verifyBytes)

    if (verifyText !== 'alina-vault-ok') return false

    dataKey = candidateKey
    return true
  } catch {
    return false // ← falscher PIN führt hier her
  }
}

/** Vault wieder zusperren — DEK aus dem Speicher kicken. */
export function lockVault(): void {
  dataKey = null
}

/** Verschlüsselt einen String mit dem aktuellen DEK. Wirft, wenn der Vault zu ist. */
export async function vaultEncrypt(plaintext: string): Promise<string> {
  if (!dataKey) throw new Error('Vault is locked')
  const encoded = new TextEncoder().encode(plaintext)
  const raw = await encryptRaw(dataKey, encoded)
  return ENCRYPTED_PREFIX + raw
}

/**
 * Entschlüsselt einen Vault-String. Werte ohne `v1:`-Prefix kommen
 * unverändert zurück — das ist der Pfad für noch nicht migrierte
 * Klartext-Daten (siehe `migrateToVault()` in storage.ts).
 */
export async function vaultDecrypt(ciphertext: string): Promise<string> {
  if (!dataKey) throw new Error('Vault is locked')
  if (!ciphertext.startsWith(ENCRYPTED_PREFIX)) {
    return ciphertext
  }
  const raw = ciphertext.slice(ENCRYPTED_PREFIX.length)
  const plainBytes = await decryptRaw(dataKey, raw)
  return new TextDecoder().decode(plainBytes)
}

/**
 * PIN ändern — ohne die eigentlichen Daten anzufassen.
 *
 * Ablauf:
 *   1. DEK mit dem alten KEK auswickeln.
 *   2. Neues Salt würfeln, neuen KEK aus dem neuen PIN ableiten.
 *   3. DEK mit dem neuen KEK neu einwickeln und persistieren.
 *   4. DEK weiter als non-extractable WebCrypto-Key halten.
 *   5. Verifikationstoken neu verschlüsseln (selbe DEK, frischer IV).
 *
 * Da der DEK gleich bleibt, müssen weder Identitäten noch Nachrichten
 * neu verschlüsselt werden — egal wie viele MB an Chat-History.
 */
export async function changeVaultPin(oldPin: string, newPin: string): Promise<boolean> {
  const saltB64 = localStorage.getItem(VAULT_SALT)
  const encDEK = localStorage.getItem(VAULT_DEK)
  if (!saltB64 || !encDEK) return false

  try {
    const oldSalt = fromBase64(saltB64)
    const oldKEK = await deriveKEK(oldPin, oldSalt)
    const dekBytes = await decryptRaw(oldKEK, encDEK)

    const newSalt = crypto.getRandomValues(new Uint8Array(32))
    const newKEK = await deriveKEK(newPin, newSalt)
    const newEncDEK = await encryptRaw(newKEK, dekBytes)

    dataKey = await crypto.subtle.importKey(
      'raw',
      dekBytes,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )

    dekBytes.fill(0)

    localStorage.setItem(VAULT_SALT, toBase64(newSalt))
    localStorage.setItem(VAULT_DEK, newEncDEK)

    // Verify-Token muss ebenfalls neu rein, sonst stimmt der IV nicht
    const verify = await vaultEncrypt('alina-vault-ok')
    localStorage.setItem(VAULT_VERIFY, verify)

    return true
  } catch {
    return false
  }
}

/**
 * Vault komplett zerstören (Logout-Flow).
 * Damit ist der DEK weg und alle verschlüsselten Werte sind unbrauchbarer
 * Müll. `clearAll()` in storage.ts schmeißt sie anschließend raus.
 */
export function destroyVault(): void {
  dataKey = null
  localStorage.removeItem(VAULT_SALT)
  localStorage.removeItem(VAULT_DEK)
  localStorage.removeItem(VAULT_VERIFY)
}
