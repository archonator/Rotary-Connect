/**
 * Krypto-Schicht der App.
 *
 * Dieses Modul kapselt alles, was mit Schlüsseln, Signaturen und
 * Nachrichten-Verschlüsselung zu tun hat. Es nutzt:
 *
 *   • `nostr-tools` für secp256k1-Schlüssel + Event-Signaturen
 *   • NIP-04 (ECDH + AES-256-CBC) für klassische Direktnachrichten
 *   • NIP-44 + NIP-17 (Sealed Sender + Gift Wrap) für Gruppenräume
 *   • Eigene Logik für die Schlüsselrotation (kind 10051)
 *
 * Was hier NICHT passiert: lokale "at-rest"-Verschlüsselung der
 * gespeicherten Daten — das macht `vault.ts` mit AES-GCM und einem
 * PIN-abgeleiteten Schlüssel.
 */

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

// nip19 stellt die bech32-Kodierung bereit (nsec1…/npub1…), die wir
// in der UI anzeigen — direkt re-exportiert für andere Module.
export { nip19 }

// ── NIP-44 Verschlüsselung (Basis für NIP-17 Gift Wraps) ─────────────────────
//
// NIP-44 ist die "modernere" Variante zu NIP-04: ChaCha20 + HMAC-SHA256
// mit besseren Sicherheitseigenschaften. Wir nutzen sie für Gift Wraps
// und Seals; klassische DMs bleiben auf NIP-04 (das ist der Standard,
// den jeder Nostr-Client versteht).

/**
 * Verschlüsselt einen String per NIP-44 für genau einen Empfänger.
 *
 * Der "ConversationKey" wird per ECDH aus dem privaten Schlüssel des
 * Senders und dem öffentlichen Schlüssel des Empfängers abgeleitet —
 * beide Seiten kommen über ihre jeweils eigenen Schlüssel zum gleichen
 * Wert.
 */
export function nip44Encrypt(
  privkey: Uint8Array,
  recipientPubkey: string,
  plaintext: string,
): string {
  const key = nip44.v2.utils.getConversationKey(privkey, recipientPubkey)
  return nip44.v2.encrypt(plaintext, key)
}

/** Spiegelbild zu nip44Encrypt — aus Empfänger-Sicht. */
export function nip44Decrypt(
  privkey: Uint8Array,
  senderPubkey: string,
  ciphertext: string,
): string {
  const key = nip44.v2.utils.getConversationKey(privkey, senderPubkey)
  return nip44.v2.decrypt(ciphertext, key)
}

// ── NIP-17 Seal & Gift Wrap ───────────────────────────────────────────────────
//
// Eine Gruppenraum-Nachricht durchläuft drei Hüllen:
//
//   1. Rumor (Kind 14) — die eigentliche Chat-Nachricht, UNSIGNIERT.
//      Würde sie signiert werden, wäre der Sender direkt sichtbar.
//
//   2. Seal (Kind 13)  — der Rumor verschlüsselt mit NIP-44 und
//      mit dem ECHTEN Schlüssel des Senders signiert. Nur der
//      Empfänger kann ihn entpacken — niemand anders weiß, von wem
//      das Seal stammt.
//
//   3. Gift Wrap (Kind 1059) — der Seal nochmal verschlüsselt, dieses
//      Mal mit einem WEGWERFSCHLÜSSEL. Das Gift Wrap ist das einzige,
//      was tatsächlich auf dem Relay landet. Beobachter sehen nur:
//      "Irgendein Wegwerfschlüssel hat irgendwem ein Paket geschickt."
//      Sender-Identität bleibt verborgen.
//
// Beim Empfang wird die Reihenfolge umgekehrt:
//   Gift Wrap → unwrap → Seal → unseal → Rumor

/**
 * Erzeugt ein Kind-13-Seal für genau einen Empfänger.
 * Der Pubkey des Senders wird beim Signieren von `finalizeEvent`
 * automatisch eingetragen.
 */
export function createSeal(
  senderPrivkey: Uint8Array,
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

/**
 * Wickelt ein Seal in ein Gift Wrap (Kind 1059) ein.
 *
 * Der ephemerePrivkey wird hier frisch erzeugt und nach Gebrauch
 * weggeworfen — er existiert nur, um die Signatur des Wraps zu setzen.
 * Dadurch ist auf Relay-Ebene nicht erkennbar, von wem ein bestimmter
 * Gift Wrap stammt: jeder Wrap hat scheinbar einen anderen Absender.
 */
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

/**
 * Entpackt ein Kind-1059 Gift Wrap.
 *
 * Liefert das innere Seal — oder `null`, wenn entweder die
 * Entschlüsselung fehlschlägt (also: nicht für uns bestimmt) oder
 * das Innere kein gültiges Seal ist (Manipulationsversuch).
 */
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

/**
 * Bricht das Seal auf und gibt das innere Rumor (Kind 14) heraus.
 *
 * Im Rumor steht der ECHTE Sender-Pubkey (`seal.pubkey`) — wir
 * benutzen den anschließend zum Anzeigen / Deduplizieren. Das hier
 * ist also der Punkt, an dem die Anonymität aufgehoben wird, aber
 * das passiert komplett im Browser des Empfängers.
 */
export function unsealRumor(
  recipientPrivkey: Uint8Array,
  seal: VerifiedEvent,
): { kind: number; pubkey: string; content: string; created_at: number; tags: string[][] } | null {
  try {
    const rumorJson = nip44Decrypt(recipientPrivkey, seal.pubkey, seal.content)
    return JSON.parse(rumorJson)
  } catch { return null }
}

/**
 * Liefert einen zufälligen Unix-Zeitstempel im Bereich [now − 48h, now].
 *
 * Wir benutzen das für `created_at` in Seals/Gift Wraps, damit ein
 * Beobachter nicht über die Zeitstempel rekonstruieren kann, wer mit
 * wem wann geredet hat. NIP-17 empfiehlt explizit nur Vergangenheit,
 * weil viele Relays "Future"-Events ablehnen.
 */
function randomTimestamp(): number {
  const now = Math.floor(Date.now() / 1000)
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr) // ←kryptografisch sicher, nicht Math.random()
  const jitter = (arr[0] ?? 0) % 172800 // 0..48h in Sekunden
  return now - jitter
}

// ── Schlüsselpaare und Bech32-Kodierung ──────────────────────────────────────

/** Erzeugt ein neues secp256k1-Schlüsselpaar (privkey 32 Byte, pubkey 64 Hex-Zeichen). */
export function createKeyPair(): { privkey: Uint8Array; pubkey: string } {
  const privkey = generateSecretKey()
  const pubkey = getPublicKey(privkey)
  return { privkey, pubkey }
}

/** Re-Derivation des öffentlichen Schlüssels aus dem privaten Schlüssel. */
export function pubkeyFromPrivkey(privkey: Uint8Array): string {
  return getPublicKey(privkey)
}

/**
 * Wandelt einen `nsec1…`-String (was der User als "geheimen Schlüssel"
 * sieht) zurück in die rohen 32 Byte. Wirft, wenn der String kein
 * gültiger nsec ist — Aufrufer fängt das und zeigt eine Fehlermeldung.
 */
export function decodeNsec(nsec: string): Uint8Array {
  const decoded = nip19.decode(nsec)
  if (decoded.type !== 'nsec') throw new Error('Not an nsec key')
  return decoded.data as Uint8Array
}

/** Pubkey (Hex) → npub1…-String für die Anzeige in der UI. */
export function encodeNpub(pubkey: string): string {
  return nip19.npubEncode(pubkey)
}

/** Spiegelbild zu encodeNpub — verwendet z. B. beim manuellen Hinzufügen eines Kontakts. */
export function decodeNpub(npub: string): string {
  const decoded = nip19.decode(npub)
  if (decoded.type !== 'npub') throw new Error('Not an npub key')
  return decoded.data as string
}

/** Privkey (Bytes) → nsec1…-String für Anzeige/Backup. */
export function encodeNsec(privkey: Uint8Array): string {
  return nip19.nsecEncode(privkey)
}

// ── NIP-04 Direktnachrichten ─────────────────────────────────────────────────
//
// NIP-04 ist die "klassische" Nostr-DM:
//   1. Beide Seiten leiten per ECDH ein gemeinsames Geheimnis ab.
//   2. AES-256-CBC mit zufälligem IV verschlüsselt den Klartext.
//   3. Das Ergebnis landet als `content` in einem signierten Kind-4-Event.
//
// Schwächer als NIP-44 (kein authentisierter Mode), aber von allen
// Clients verstanden — daher hier weiterhin für 1:1-Chats.

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

// ── Generische Event-Helfer ──────────────────────────────────────────────────

/**
 * Signiert ein UnsignedEvent (= Event ohne id und sig) mit dem privkey.
 * `finalizeEvent` setzt automatisch `pubkey`, `id` (Hash) und `sig`.
 */
export function createSignedEvent(
  event: UnsignedEvent,
  privkey: Uint8Array,
): VerifiedEvent {
  return finalizeEvent(event, privkey) as VerifiedEvent
}

/**
 * Prüft Signatur und Hash eines eingehenden Events.
 * Aufrufer sollte das IMMER vor der Weiterverarbeitung tun, sonst kann
 * ein böswilliger Relay beliebige Inhalte unter beliebiger pubkey
 * ausliefern.
 */
export function isValidEvent(event: unknown): boolean {
  return verifyEvent(event as VerifiedEvent)
}

// ── Hashes für Räume und Einladungscodes ─────────────────────────────────────

/**
 * Wandelt einen Raumnamen in einen 64-Hex-Zeichen-Hash um.
 * Vor dem Hashen wird kleingeschrieben, damit "Rotary Berlin"
 * und "rotary berlin" denselben Raum ergeben. Der Prefix
 * "alina-room-v1:" stammt aus dem Vorgängerprojekt — Änderung
 * würde alle bestehenden Räume invalidieren, daher beibehalten.
 */
export async function hashRoomName(name: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode('alina-room-v1:' + name.toLowerCase())
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Hash eines Einladungscodes — wird auf dem Relay als Filter-Tag
 * verwendet, damit der Klartext-Code nirgendwo öffentlich landet.
 */
export async function hashInviteCode(code: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode('alina-invite-v1:' + code)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── Schlüsselrotation ────────────────────────────────────────────────────────
//
// Rotation funktioniert über zwei sich gegenseitig referenzierende
// Signaturen, beide vom Kind 10051:
//
//   1. Eine "Cross-Signature": der NEUE Schlüssel signiert die Aussage
//      "Ich übernehme von <oldPubkey>, Zeit <ts>". Beweist: der neue
//      Schlüssel weiß, was er tut.
//
//   2. Das eigentliche Migrations-Event: der ALTE Schlüssel signiert
//      ein Event, das die Cross-Signature im Content trägt. Beweist:
//      der alte Schlüssel-Eigentümer hat die Migration autorisiert.
//
// Beide Signaturen sind nötig — eine alleine wäre fälschbar.

/**
 * Erzeugt die Cross-Signature: ein vom NEUEN Schlüssel signiertes
 * Kind-10051-Event mit dem alten Pubkey im "proof"-Tag.
 */
export function createCrossSignature(
  newPrivkey: Uint8Array,
  oldPubkey: string,
): string {
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
 * Baut das Migrations-Event: signiert vom ALTEN Schlüssel,
 * enthält den neuen Pubkey + die Cross-Signature.
 *
 * Der alte Pubkey ist implizit im `pubkey`-Feld des signierten
 * Events enthalten — kein separates Argument nötig.
 */
export function createMigrationEvent(
  oldPrivkey: Uint8Array,
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
 * Verifiziert ein eingehendes Migrations-Event.
 *
 * Drei Checks müssen bestehen, sonst wird das Event verworfen:
 *
 *   (a) Die Cross-Signature ist ein gültiges Nostr-Event (Hash + Sig).
 *   (b) Der Pubkey, der sie signiert hat, stimmt mit dem behaupteten
 *       neuen Pubkey überein — sonst könnte jemand einfach eine
 *       fremde Signatur einkleben.
 *   (c) Das proof-Tag der Cross-Signature zeigt auf den ALTEN Pubkey
 *       (= `event.pubkey` des Outer-Events) — sonst könnte jemand eine
 *       beliebige Migration umetikettieren.
 *
 * Erst wenn alle drei stimmen, geben wir { valid, oldPubkey, newPubkey }
 * an den Aufrufer zurück. `null` bei jedem Fehlschlag.
 */
export function verifyMigrationEvent(
  event: { pubkey: string; content: string; kind: number },
): { valid: boolean; oldPubkey: string; newPubkey: string } | null {
  try {
    if (event.kind !== KEY_MIGRATION_KIND) return null

    const payload = JSON.parse(event.content)
    const { newPubkey, crossSignature } = payload
    if (!newPubkey || !crossSignature) return null

    // (a) gültige Signatur auf der Cross-Sig
    const proofEvent = JSON.parse(crossSignature)
    if (!verifyEvent(proofEvent)) return null

    // (b) Cross-Sig wurde tatsächlich vom behaupteten neuen Schlüssel signiert
    if (proofEvent.pubkey !== newPubkey) return null

    // (c) Das proof-Tag verweist auf den alten Pubkey (das Outer-Event-pubkey)
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
