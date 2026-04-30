/**
 * Nostr-Schicht der App.
 *
 * Verantwortlich für:
 *   • Verbindungsaufbau zu allen konfigurierten Relays (eine eigene
 *     WebSocket pro Relay) inklusive automatischem Reconnect.
 *   • Subscriptions für DMs, Gift Wraps, Raum-Presences,
 *     WebRTC-Signaling und Schlüsselmigrationen.
 *   • Versand: signierte Events publishen, optional zuvor verschlüsseln.
 *   • Empfang: Events einsortieren und an die richtigen Handler routen.
 *
 * Dieses Modul kennt **keinen React-Zustand** direkt. Stattdessen
 * registrieren useNostrRelays-Effekt zwei Callbacks:
 *   - `setOnMessage(cb)`        — wird gerufen, wenn eine Chat-Nachricht
 *                                 ankommt; cb landet im Zustand-Store.
 *   - `setGetState(() => …)`    — liefert den aktuellen Snapshot von
 *                                 Identität + Kontakten + Räumen, sodass
 *                                 Empfangshandler entscheiden können,
 *                                 ob/wie sie reagieren.
 *
 * So bleibt das Modul testbar ohne React und vermeidet zyklische
 * Importe (Store ↔ Nostr).
 */

import { RELAYS, INVITE_KIND, INVITE_CODE_DURATION, GIFT_WRAP_KIND, CHAT_MESSAGE_KIND, ROOM_PRESENCE_KIND, KEY_MIGRATION_KIND, WEBRTC_SIGNAL_KIND } from './constants'
import { createSignedEvent, isValidEvent, encryptDM, decryptDM, hashInviteCode, createSeal, createGiftWrap, unwrapGiftWrap, unsealRumor, createKeyPair, createCrossSignature, createMigrationEvent, verifyMigrationEvent } from './crypto'
import { saveLog } from './storage'
import { handleSignalingEvent } from './webrtc/SignalingChannel'
import { sendViaPeer, isPeerConnected } from './webrtc/PeerManager'
import type { DataMessage } from './webrtc/types'
import type { Message } from '../store/useStore'

// ── Reconnect-Strategie ──────────────────────────────────────────
//
// Pro Relay zählen wir aufeinanderfolgende Disconnects. Beim Versuch
// neu zu verbinden warten wir
//   BASE_RECONNECT_DELAY * 2^(Fehler − 1),
// gekappt bei MAX_RECONNECT_DELAY. Erfolg setzt den Zähler zurück.

const BASE_RECONNECT_DELAY = 5000   // 5 s nach dem ersten Disconnect
const MAX_RECONNECT_DELAY = 120000  // höchstens 2 min Wartezeit
const relayfailures: Record<string, number> = {}

export interface RelayConnection {
  url: string
  ws: WebSocket
}

/** Aktuell offene Relay-Verbindungen. */
let relays: RelayConnection[] = []

/** Wird vom `useNostrRelays`-Hook verkabelt; kanalisiert Nachrichten in den Store. */
let onMessageCallback: ((chatId: string, msg: Message) => void) | null = null

/** Für die Beantwortung von Invite-Lookups: random-subId → Resolver. */
type InviteResult = { pubkey: string; name: string }
const pendingInviteLookups = new Map<string, (result: InviteResult | null) => void>()

/**
 * Snapshot-Funktion vom Hook bereitgestellt. Wir rufen sie auf, wenn
 * ein eingehendes Event Kontext braucht (Wer bin ich? Welche Räume kenne
 * ich? …) — das vermeidet, in diesem Modul den Store-Import einzubauen.
 */
let getStateCallback: (() => {
  privkey: Uint8Array | null
  pubkey: string | null
  name: string
  contacts: Record<string, { pubkey: string; name: string }>
  rooms: Record<string, { name: string; hash: string; members: string[] }>
  addRoomMember: (hash: string, pubkey: string) => void
}) | null = null

/**
 * Drosselung für Selbst-Präsenz-Broadcasts pro Raum.
 *
 * Hintergrund: Wenn ein neues Mitglied auftaucht, antworten wir mit
 * einer eigenen Presence, damit der Neuling uns ebenfalls in seine
 * Mitgliederliste aufnimmt. Ohne Drosselung würde ein voller Raum,
 * der gleichzeitig joined, einen O(n²)-Presence-Sturm erzeugen — pro
 * Raum darum höchstens eine Self-Presence alle 30 s.
 */
const lastSelfPresenceAt: Record<string, number> = {}
const SELF_PRESENCE_THROTTLE_MS = 30_000

function maybeAnnouncePresence(roomHash: string): void {
  const state = getStateCallback?.()
  if (!state?.privkey || !state.pubkey) return
  const room = state.rooms[roomHash]
  if (!room) return
  const now = Date.now()
  const last = lastSelfPresenceAt[roomHash] ?? 0
  if (now - last < SELF_PRESENCE_THROTTLE_MS) return
  lastSelfPresenceAt[roomHash] = now
  publishRoomPresence(state.privkey, state.pubkey, roomHash, state.name)
}

export function setOnMessage(cb: typeof onMessageCallback): void {
  onMessageCallback = cb
}

export function setGetState(cb: typeof getStateCallback): void {
  getStateCallback = cb
}

export function getRelays(): RelayConnection[] {
  return relays
}

export function getRelayCount(): number {
  return relays.length
}

type RelayCountListener = (count: number) => void
let relayCountListener: RelayCountListener | null = null

export function setRelayCountListener(cb: RelayCountListener | null): void {
  relayCountListener = cb
}

function notifyRelayCount(): void {
  relayCountListener?.(relays.length)
}

/**
 * Eröffnet die fünf Standard-Subscriptions auf einem Relay.
 *
 * Wir verwenden für jeden Subscription-Typ einen FESTEN sub-id-String
 * (z. B. "dm-sub"). Das hat einen netten Nebeneffekt: Beim erneuten
 * Aufruf von subscribeAll (z. B. nach addContact) ersetzt das Relay
 * die alte Subscription mit derselben ID — wir bekommen keine
 * Mehrfach-Subscriptions, sondern eine aktualisierte Filterliste.
 */
function subscribeAll(ws: WebSocket): void {
  const state = getStateCallback?.()
  if (!state?.pubkey) return

  // (1) NIP-04 DMs an mich
  const dmSub = JSON.stringify(['REQ', 'dm-sub', { kinds: [4], '#p': [state.pubkey], limit: 100 }])
  ws.send(dmSub)

  // (2) NIP-17 Gift Wraps an mich (verschlüsselte Raum-Nachrichten)
  const gwSub = JSON.stringify(['REQ', 'gw-sub', { kinds: [GIFT_WRAP_KIND], '#p': [state.pubkey], limit: 200 }])
  ws.send(gwSub)

  // (3) WebRTC-Signaling an mich. Limit + since=now-60 verhindern,
  //     dass uns alte Signale aus früheren Sessions verfolgen.
  const sigSub = JSON.stringify(['REQ', 'sig-sub', { kinds: [WEBRTC_SIGNAL_KIND], '#p': [state.pubkey], limit: 20, since: Math.floor(Date.now() / 1000) - 60 }])
  ws.send(sigSub)

  // (4) Schlüsselrotationen meiner bekannten Kontakte
  const contactPubkeys = Object.keys(state.contacts)
  if (contactPubkeys.length) {
    const migSub = JSON.stringify(['REQ', 'mig-sub', { kinds: [KEY_MIGRATION_KIND], authors: contactPubkeys, limit: 50 }])
    ws.send(migSub)
  }

  // (5) Raum-Presence-Events meiner abonnierten Räume
  const roomHashes = Object.values(state.rooms).map(r => r.hash)
  if (roomHashes.length) {
    const roomSub = JSON.stringify(['REQ', 'room-sub', { kinds: [ROOM_PRESENCE_KIND], '#e': roomHashes, limit: 200 }])
    ws.send(roomSub)
  }
}

/**
 * Baut die WebSocket zu einem Relay auf und verkabelt die Lifecycle-
 * Handler. Ruft sich bei `onclose` selbst rekursiv mit Delay auf —
 * dadurch implementiert eine einzige Funktion sowohl initialen
 * Connect als auch Reconnect.
 */
function connectRelay(url: string): void {
  try {
    const ws = new WebSocket(url)

    ws.onopen = () => {
      // Erfolgreicher Connect → Failure-Counter zurücksetzen
      relayfailures[url] = 0
      relays.push({ url, ws })
      notifyRelayCount()
      subscribeAll(ws)
      saveLog('relay', 'Connected to ' + url)
    }

    ws.onmessage = (e) => handleRelayMessage(e.data)

    ws.onerror = (e) => {
      // Fehler wird hier nur geloggt — der Verbindungsabbau läuft
      // anschließend über onclose, dort warten wir mit dem Reconnect.
      saveLog('relay-error', 'WebSocket error on ' + url + ': ' + String(e))
    }

    ws.onclose = (e) => {
      relays = relays.filter(r => r.url !== url)
      notifyRelayCount()
      const failures = (relayfailures[url] || 0) + 1
      relayfailures[url] = failures
      const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, failures - 1), MAX_RECONNECT_DELAY)
      saveLog('relay', 'Disconnected from ' + url + ' (code ' + e.code + '), reconnect in ' + Math.round(delay / 1000) + 's')
      setTimeout(() => connectRelay(url), delay)
    }
  } catch (e) {
    saveLog('relay-error', 'Failed to connect to ' + url + ': ' + String(e))
  }
}

/** Verbindet zu allen konfigurierten Relays parallel. */
export function connectAllRelays(): void {
  RELAYS.forEach(url => connectRelay(url))
}

/** Schließt alle Relay-Verbindungen — z. B. beim Logout/Unmount. */
export function disconnectAllRelays(): void {
  relays.forEach(r => {
    try { r.ws.close() } catch (e) {
      saveLog('relay-error', 'Error closing ' + r.url + ': ' + String(e))
    }
  })
  relays = []
  notifyRelayCount()
}

/**
 * Schickt ein bereits signiertes Event an ALLE verbundenen Relays.
 * Mehrfach-Zustellung ist bei Nostr Standard — der Empfänger
 * dedupliziert über die event.id (oder bei Gift Wraps über die seal.id).
 */
export function publishToRelays(event: object): void {
  const msg = JSON.stringify(['EVENT', event])
  relays.forEach(r => {
    try { r.ws.send(msg) } catch (e) {
      saveLog('relay-error', 'Failed to publish to ' + r.url + ': ' + String(e))
    }
  })
}

/**
 * Erneuert die Subscriptions auf allen Relays. Wird aufgerufen, wenn
 * sich die "interessante Menge" ändert — z. B. nach addContact (mig-sub
 * muss den neuen Author umfassen) oder addRoom (room-sub muss den neuen
 * Hash filtern).
 */
export function resubscribeAll(): void {
  relays.forEach(r => subscribeAll(r.ws))
}

/**
 * Zentrale Dispatcher-Funktion für alles, was vom Relay reinkommt.
 *
 * Nostr-Relays sprechen ein einfaches Array-Protokoll. Wir interessieren
 * uns hier nur für `["EVENT", subId, event]`. Der subId-Trick erlaubt es,
 * Antwort-Streams (Invite-Lookups) von "normalen" Subscriptions zu
 * unterscheiden.
 *
 * Ablauf:
 *   1. Antwort auf eine offene Invite-Anfrage? → Promise auflösen, fertig.
 *   2. Gift Wrap (Kind 1059)? → `verifyEvent` würde scheitern, weil der
 *      Outer-Wrap mit einem ephemeren Key signiert ist; wir verifizieren
 *      stattdessen das innere Seal beim Aufmachen. Direkt zur Auspack-Logik.
 *   3. WebRTC-Signal? → in den WebRTC-Layer weiterreichen.
 *   4. Sonst: Standard-Verifikation (Hash + Sig) und je nach Kind dispatchen.
 */
async function handleRelayMessage(raw: string): Promise<void> {
  try {
    const data = JSON.parse(raw)

    if (data[0] === 'EVENT') {
      const subId = data[1] as string
      const event = data[2]

      // (1) Invite-Lookup-Antwort?
      const inviteHandler = pendingInviteLookups.get(subId)
      if (inviteHandler && event.kind === INVITE_KIND) {
        pendingInviteLookups.delete(subId)
        // Subscription wieder schließen — wir wollten nur ein Event
        relays.forEach(r => {
          try { r.ws.send(JSON.stringify(['CLOSE', subId])) } catch (e) {
            saveLog('relay-error', 'Failed to close invite sub on ' + r.url + ': ' + String(e))
          }
        })
        try {
          const parsed = JSON.parse(event.content)
          inviteHandler({ pubkey: event.pubkey, name: parsed.name || '' })
        } catch {
          inviteHandler(null)
        }
        return
      }

      // (2) Gift Wrap → eigene Verifikation des Inhalts
      if (event.kind === GIFT_WRAP_KIND) {
        await handleGiftWrap(event)
        return
      }

      // (3) WebRTC-Signal an mich
      if (event.kind === WEBRTC_SIGNAL_KIND) {
        const state = getStateCallback?.()
        if (state?.privkey && state.pubkey) {
          await handleSignalingEvent(state.privkey, state.pubkey, event)
        }
        return
      }

      // (4) Alles andere muss korrekt signiert sein
      if (!isValidEvent(event)) return

      if (event.kind === 4) {
        await handleDM(event)
      } else if (event.kind === ROOM_PRESENCE_KIND) {
        handleRoomPresence(event)
      } else if (event.kind === KEY_MIGRATION_KIND) {
        handleMigrationEvent(event)
      }
    }
  } catch (e) {
    saveLog('relay-error', 'Failed to handle relay message: ' + String(e))
  }
}

/**
 * Verarbeitet eine eingehende NIP-04-DM (Kind 4).
 *
 * Validierungs-Stack vor der Übergabe an den Store:
 *   • Eigene Nachrichten ignorieren (haben wir lokal beim Senden schon
 *     abgelegt — sonst hätten wir Doppelte).
 *   • Größenlimit: 1 MB nach Entschlüsselung. Schutz vor Speicher-DoS,
 *     z. B. durch absichtlich aufgeblasene Inhalte.
 *   • Strukturprüfung: Inhalt muss `{ content: string }` sein.
 *   • TTL-Check: bereits abgelaufene Nachrichten (Clock Skew zwischen
 *     Sender und Empfänger > TTL) verwerfen, statt sie kurz anzuzeigen
 *     und sofort wieder zu entfernen.
 */
async function handleDM(event: { id?: string; pubkey: string; content: string; created_at: number }): Promise<void> {
  const state = getStateCallback?.()
  if (!state?.privkey || !state.pubkey) return

  const fromPubkey = event.pubkey
  if (fromPubkey === state.pubkey) return // eigene Nachricht — schon lokal vorhanden

  const chatId = 'dm:' + fromPubkey

  try {
    const decrypted = await decryptDM(state.privkey, fromPubkey, event.content)
    if (decrypted.length > 1_000_000) return
    const parsed = JSON.parse(decrypted)
    if (!parsed.content || typeof parsed.content !== 'string') return

    const now = Date.now()
    const ttl = parsed.ttl ? Number(parsed.ttl) : undefined
    const expiresAt = ttl ? now + ttl * 1000 : undefined
    if (expiresAt && expiresAt <= now) return

    const msg: Message = {
      type: parsed.type || 'text',
      content: parsed.content,
      pubkey: fromPubkey,
      ts: event.created_at * 1000,
      eventId: event.id,
      ...(ttl ? { ttl, expiresAt } : {}),
    }
    onMessageCallback?.(chatId, msg)
  } catch (e) {
    saveLog('decrypt-error', 'Failed to decrypt DM')
  }
}

/**
 * Verarbeitet ein Kind-42 Presence-Event ("Ich bin im Raum X").
 *
 * Diese Events tragen keinen Chat-Inhalt — nur die Information, dass
 * ein bestimmter Pubkey Mitglied eines bestimmten Raums ist. Wir
 * nutzen sie, um beim nächsten Senden auch diesen Member als
 * Gift-Wrap-Empfänger zu berücksichtigen.
 *
 * Wenn dieser Member uns vorher unbekannt war, schicken wir gleich
 * unsere eigene Presence zurück — andernfalls wüsste die Gegenseite
 * nicht, dass es uns gibt, und unsere Nachrichten kämen nie an.
 */
function handleRoomPresence(event: { id?: string; pubkey: string; content: string; created_at: number; tags: string[][] }): void {
  const state = getStateCallback?.()
  if (!state) return

  const roomHashTag = event.tags.find((t: string[]) => t[0] === 'e')
  const roomHash = roomHashTag?.[1]
  if (!roomHash) return
  const room = state.rooms[roomHash]
  if (!room) return // Presence für einen Raum, dem wir nicht beigetreten sind

  const fromPubkey = event.pubkey
  if (fromPubkey === state.pubkey) return // eigene Presence

  const wasNew = !room.members.includes(fromPubkey)
  state.addRoomMember(roomHash, fromPubkey)
  if (wasNew) {
    saveLog('room', 'Discovered member ' + fromPubkey.slice(0, 8) + '... in room ' + room.name)
    maybeAnnouncePresence(roomHash) // bidirektionaler Handshake (gedrosselt)
  }
}

/**
 * Verarbeitet ein Kind-1059 Gift Wrap (NIP-17) — entpackt zwei Hüllen
 * tief und legt die enthaltene Chat-Nachricht im Store ab.
 *
 * Workflow Schritt für Schritt:
 *   1. Gift Wrap → Seal (mit eigenem privkey entschlüsseln).
 *   2. Wenn der Seal vom eigenen Pubkey kommt → ignorieren (lokal vorhanden).
 *   3. Seal → Rumor (mit dem Seal-pubkey entschlüsseln).
 *   4. Rumor-Tags auf Raum-Hash prüfen; nur Räume bedienen, in denen
 *      wir auch sind.
 *   5. Sender als Mitglied vermerken, ggf. Presence-Handshake auslösen.
 *   6. Größen- und Strukturchecks wie bei DMs.
 *   7. Display-Name wählen: bekannter Kontaktname > Sender-Name aus
 *      dem Rumor > gekürzter Pubkey.
 *   8. Dedupliziert wird über `seal.id` — gewollt nicht über event.id,
 *      weil identische Nachrichten an verschiedene Empfänger
 *      verschiedene Wrap-IDs haben, aber die gleiche Seal-ID.
 */
async function handleGiftWrap(event: { id?: string; pubkey: string; content: string; created_at: number; tags: string[][] }): Promise<void> {
  const state = getStateCallback?.()
  if (!state?.privkey || !state.pubkey) return

  try {
    // Step 1: Unwrap Gift Wrap → get Seal (Kind 13)
    const seal = unwrapGiftWrap(state.privkey, event)
    if (!seal) return

    const senderPubkey = seal.pubkey
    if (senderPubkey === state.pubkey) return // own messages already stored locally

    // Step 2: Unseal → get Rumor (Kind 14)
    const rumor = unsealRumor(state.privkey, seal)
    if (!rumor || rumor.kind !== CHAT_MESSAGE_KIND) return

    // Step 3: Extract room hash from rumor tags
    const roomHashTag = rumor.tags.find((t: string[]) => t[0] === 'e')
    const roomHash = roomHashTag?.[1]
    const room = roomHash ? state.rooms[roomHash] : undefined
    if (!roomHash || !room) return

    // Learn this member; if new, announce ourselves so they know to gift-wrap us next time.
    const wasNew = !room.members.includes(senderPubkey)
    state.addRoomMember(roomHash, senderPubkey)
    if (wasNew) maybeAnnouncePresence(roomHash)

    // Step 4: Parse message content (with size/structure validation)
    if (rumor.content.length > 1_000_000) return // reject oversized payloads
    const parsed = JSON.parse(rumor.content)
    if (!parsed.content || typeof parsed.content !== 'string') return
    const now = Date.now()
    const ttl = parsed.ttl ? Number(parsed.ttl) : undefined
    const expiresAt = ttl ? now + ttl * 1000 : undefined
    if (expiresAt && expiresAt <= now) return

    const displayName = state.contacts[senderPubkey]?.name
      || parsed.name
      || senderPubkey.slice(0, 8) + '...'

    const chatId = 'room:' + roomHash
    const msg: Message = {
      type: parsed.type || 'text',
      content: parsed.content,
      pubkey: senderPubkey,
      name: displayName,
      ts: rumor.created_at * 1000,
      // Use the SEAL id (signed by the sender) as the dedup key, NOT the gift-wrap id
      // — gift wraps use ephemeral keys and have a different id per recipient/relay,
      // which would let duplicates slip through.
      eventId: seal.id,
      ...(ttl ? { ttl, expiresAt } : {}),
    }
    onMessageCallback?.(chatId, msg)
  } catch (e) {
    saveLog('giftwrap-error', 'Failed to unwrap gift wrap')
  }
}

/**
 * Versendet eine Direktnachricht an einen einzelnen Empfänger.
 *
 * Reihenfolge:
 *   1. Falls eine offene WebRTC-Verbindung zum Empfänger besteht,
 *      Nachricht direkt über den Datenkanal schicken — keine Relays
 *      involviert, niedrigste Latenz.
 *   2. Sonst (oder wenn der Datenkanal-Send fehlschlägt): NIP-04
 *      verschlüsseln und an alle verbundenen Relays publishen.
 */
export async function publishDM(
  privkey: Uint8Array,
  myPubkey: string,
  recipientPubkey: string,
  msgData: { type: string; content: string },
): Promise<void> {
  if (isPeerConnected(recipientPubkey)) {
    const p2pMsg: DataMessage = {
      // Aus Sicht des Senders steht in chatId der MEINE pubkey, denn der
      // Empfänger soll den Chat unter "dm:<senderPubkey>" finden.
      chatId: 'dm:' + myPubkey,
      msgData,
      ts: Date.now(),
    }
    const sent = sendViaPeer(recipientPubkey, p2pMsg)
    if (sent) {
      saveLog('webrtc', `DM sent via P2P to ${recipientPubkey.slice(0, 8)}...`)
      return
    }
    saveLog('webrtc', `P2P send failed, falling back to relay for ${recipientPubkey.slice(0, 8)}...`)
  }

  // Relay-Fallback
  const payload = JSON.stringify(msgData)
  const encrypted = await encryptDM(privkey, recipientPubkey, payload)
  const event = createSignedEvent({
    kind: 4,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', recipientPubkey]],
    content: encrypted,
    pubkey: myPubkey,
  }, privkey)
  publishToRelays(event)
}

/**
 * Veröffentlicht einen Einladungscode-Hash auf den Relays. Der echte
 * 6-stellige Code bleibt beim Inviter — er muss ihn dem zukünftigen
 * Kontakt out-of-band mitteilen (WhatsApp, persönlich, …). Auf den
 * Relays liegt nur sein SHA-256-Hash, sodass Mitleser nicht den
 * Klartext-Code haben.
 */
export async function publishInviteCode(
  privkey: Uint8Array,
  pubkey: string,
  name: string,
  code: string,
): Promise<void> {
  const codeHash = await hashInviteCode(code)
  const expiration = Math.floor(Date.now() / 1000) + INVITE_CODE_DURATION
  const event = createSignedEvent({
    kind: INVITE_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['t', codeHash],
      ['expiration', expiration.toString()], // NIP-40 Expiration-Tag
    ],
    content: JSON.stringify({ name }),
    pubkey,
  }, privkey)
  publishToRelays(event)
}

/**
 * Sucht nach einem Einladungscode auf den Relays.
 *
 * Eröffnet eine eigene Subscription mit zufälliger sub-id, sodass die
 * Antwort über den `pendingInviteLookups`-Map an die richtige Promise
 * geliefert wird. Bei Timeout (8 s ohne Treffer) oder Disconnect der
 * Relays wird `null` zurückgegeben.
 */
export async function lookupInviteCode(code: string): Promise<InviteResult | null> {
  const codeHash = await hashInviteCode(code)

  return new Promise((resolve) => {
    const subId = 'invite-' + Math.random().toString(36).slice(2, 10)
    let resolved = false

    // `done` einmalig sicherstellen — auch wenn mehrere Relays
    // gleichzeitig antworten oder der Timeout zuschlägt.
    const done = (result: InviteResult | null) => {
      if (resolved) return
      resolved = true
      pendingInviteLookups.delete(subId)
      resolve(result)
    }

    pendingInviteLookups.set(subId, done)
    setTimeout(() => done(null), 8000) // Timeout-Sicherheitsnetz

    const sub = JSON.stringify(['REQ', subId, {
      kinds: [INVITE_KIND],
      '#t': [codeHash],
      since: Math.floor(Date.now() / 1000) - INVITE_CODE_DURATION,
      limit: 5,
    }])

    // Edge case: Niemand verbunden — sofort null zurückgeben (sonst
    // würde der User 8 s vor einem stillen Timeout sitzen).
    if (relays.length === 0) {
      setTimeout(() => done(null), 100)
      return
    }

    relays.forEach(r => {
      try { r.ws.send(sub) } catch (e) {
        saveLog('relay-error', 'Failed to send invite lookup to ' + r.url + ': ' + String(e))
      }
    })
  })
}

/**
 * Versendet eine Gruppenraum-Nachricht.
 *
 * Im Gegensatz zu DMs gibt es bei NIP-17 KEINEN globalen Broadcast —
 * jeder bekannte Mitglieder-Pubkey bekommt eine eigene Kopie als
 * Seal+Gift-Wrap. Das ist O(n) Events pro gesendeter Nachricht, dafür
 * weiß weder der Relay noch ein Beobachter, wie viele Empfänger die
 * Nachricht eigentlich hat oder wer sie gesendet hat.
 *
 * Wir senden uns selbst NICHT — die Nachricht wurde lokal beim
 * Aufruf bereits in den Store gelegt. Das spart eine Verschlüsselung
 * und vermeidet eine doppelte Anzeige.
 *
 * Anschließend ein Presence-Event: signalisiert anderen, dass wir
 * "noch da" sind, und macht uns für künftige Sender sichtbar.
 */
export async function publishRoomMessage(
  privkey: Uint8Array,
  myPubkey: string,
  roomHash: string,
  msgData: { type: string; content: string; name: string },
): Promise<void> {
  const state = getStateCallback?.()
  const room = state?.rooms[roomHash]
  const members = room?.members ?? []

  // Kind-14-Rumor — UNSIGNIERT (Anonymitätseigenschaft von NIP-17).
  // Sender-Pubkey steht im Rumor selbst, im Seal wird er via Signatur
  // bewiesen, im Gift Wrap aber wieder versteckt.
  const rumor = {
    kind: CHAT_MESSAGE_KIND,
    pubkey: myPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['e', roomHash, '', 'root']],
    content: JSON.stringify(msgData),
  }

  // Pro Mitglied: Seal + Gift Wrap, dann publishen.
  for (const memberPubkey of members) {
    if (memberPubkey === myPubkey) continue
    try {
      const seal = createSeal(privkey, memberPubkey, rumor)
      const giftWrap = createGiftWrap(memberPubkey, seal)
      publishToRelays(giftWrap)
    } catch (e) {
      saveLog('giftwrap-error', 'Failed to wrap for room member')
    }
  }

  // Eigene Presence — gibt neuen Mitgliedern die Chance, uns zu finden
  publishRoomPresence(privkey, myPubkey, roomHash, msgData.name)
}

// ── Schlüsselrotation ────────────────────────────────────────────────────────

/**
 * Rotiert die eigene Identität auf einen neuen Schlüssel.
 *
 * Schritte:
 *   1. Neues secp256k1-Schlüsselpaar erzeugen.
 *   2. Cross-Signature: der neue Schlüssel signiert "ich übernehme von <old>".
 *   3. Migrations-Event: der alte Schlüssel signiert ein Kind-10051-Event
 *      mit der Cross-Signature im Content.
 *   4. Migrations-Event auf allen Relays publishen — Empfänger sehen es
 *      via mig-sub und können automatisch ihre Kontakteinträge aktualisieren.
 *   5. Zusätzlich an JEDEN bekannten Kontakt eine NIP-04-DM vom alten
 *      Schlüssel: belt-and-suspenders, falls ein Kontakt das Migrations-
 *      Event nicht mitbekommen hat.
 *
 * Liefert das neue Schlüsselpaar zurück; der Aufrufer (KeyMigrationModal)
 * schreibt damit die Identität im Store fort.
 */
export async function performKeyMigration(
  oldPrivkey: Uint8Array,
  oldPubkey: string,
  contacts: Record<string, { pubkey: string; name: string }>,
  myName: string,
): Promise<{ privkey: Uint8Array; pubkey: string }> {
  // Step 1: Generate new key pair
  const newKeyPair = createKeyPair()

  // Step 2: Cross-signature (new key proves it controls migration)
  const crossSig = createCrossSignature(newKeyPair.privkey, oldPubkey)

  // Step 3: Migration event (signed by old key — old pubkey is implicit in the signature)
  const migrationEvent = createMigrationEvent(
    oldPrivkey,
    newKeyPair.pubkey,
    crossSig,
  )

  // Step 4: Publish migration event to all relays
  publishToRelays(migrationEvent)

  // Step 5: Notify all contacts via encrypted DM from old key
  const notification = JSON.stringify({
    type: 'text',
    content: `[Key Migration] ${myName} has rotated their key. New public key: ${newKeyPair.pubkey.slice(0, 16)}... Please verify via QR code or fingerprint comparison.`,
  })

  for (const contact of Object.values(contacts)) {
    try {
      const encrypted = await encryptDM(oldPrivkey, contact.pubkey, notification)
      const event = createSignedEvent({
        kind: 4,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', contact.pubkey]],
        content: encrypted,
        pubkey: oldPubkey,
      }, oldPrivkey)
      publishToRelays(event)
    } catch (e) {
      saveLog('migration-error', `Failed to notify contact ${contact.pubkey.slice(0, 8)}`)
    }
  }

  saveLog('migration', `Key migration published. New pubkey: ${newKeyPair.pubkey.slice(0, 16)}...`)

  return newKeyPair
}

/**
 * Callback, der bei einer empfangenen UND verifizierten Schlüssel-
 * rotation eines bekannten Kontakts gerufen wird.
 *
 * Vom `useNostrRelays`-Hook gesetzt — er ruft `migrateContact()` im
 * Store auf, der wiederum den alten Pubkey durch den neuen ersetzt
 * und Chat-History/Unread sauber mitnimmt.
 */
let onMigrationCallback: ((oldPubkey: string, newPubkey: string) => void) | null = null

export function setOnMigration(cb: typeof onMigrationCallback): void {
  onMigrationCallback = cb
}

/**
 * Verarbeitet ein eingehendes Migrations-Event.
 *
 * Wir akzeptieren NUR Events, die
 *   (a) kryptografisch sauber sind (verifyMigrationEvent),
 *   (b) von einem KONTAKT stammen — sonst könnte jeder beliebige
 *       Pubkey im Netzwerk uns "Migrations-Spam" schicken und damit
 *       Status-Banner triggern.
 */
export function handleMigrationEvent(event: { pubkey: string; content: string; kind: number }): void {
  const result = verifyMigrationEvent(event)
  if (!result || !result.valid) return

  const state = getStateCallback?.()
  if (!state) return

  if (!state.contacts[result.oldPubkey]) return

  saveLog('migration', `Received valid key migration from ${result.oldPubkey.slice(0, 8)}... to ${result.newPubkey.slice(0, 8)}...`)
  onMigrationCallback?.(result.oldPubkey, result.newPubkey)
}

/**
 * Veröffentlicht ein Kind-42 Presence-Event ("Ich bin in Raum X").
 *
 * Das ist die ÖFFENTLICHE Komponente von NIP-17-Räumen — Inhalt ist
 * nur der eigene Anzeigename, keine Nachricht. Andere Mitglieder
 * sehen daran, dass sie uns in zukünftige Gift Wraps einschließen
 * sollen.
 */

export function publishRoomPresence(
  privkey: Uint8Array,
  myPubkey: string,
  roomHash: string,
  name: string,
): void {
  const event = createSignedEvent({
    kind: ROOM_PRESENCE_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['e', roomHash, '', 'root']],
    content: JSON.stringify({ name }),
    pubkey: myPubkey,
  }, privkey)
  publishToRelays(event)
}
