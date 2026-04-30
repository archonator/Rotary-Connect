/**
 * PeerManager — verwaltet WebRTC-Direktverbindungen zu allen Kontakten.
 *
 * Pro Kontakt höchstens eine RTCPeerConnection mit einem
 * RTCDataChannel. Sobald der Datenkanal offen ist, fließen
 * DM-Nachrichten direkt zwischen den Browsern — Relays sehen davon
 * nichts mehr.
 *
 * Verbindungsaufbau:
 *
 *     ┌───────────┐                          ┌───────────┐
 *     │ Alice     │ ── Offer  (via Nostr) ──►│ Bob       │
 *     │           │ ◄─ Answer (via Nostr) ── │           │
 *     │           │ ◄─── ICE-Kandidaten  ──► │           │
 *     │           │                          │           │
 *     │  RTCPC ◄────── direkter Datenkanal ─────► RTCPC  │
 *     └───────────┘                          └───────────┘
 *
 * Das Signaling läuft über NIP-04-verschlüsselte Kind-25050-Events
 * (siehe `SignalingChannel.ts`). Der eigentliche Nutzdatenkanal ist
 * vom Browser aufgebaut und unabhängig von den Relays.
 *
 * Fällt P2P aus oder ist der Peer offline, läuft die Nachricht
 * automatisch über den Relay-Pfad — siehe `publishDM` in `nostr.ts`.
 */

import { getIceConfig } from './iceConfig'
import type { PeerState, SignalMessage, DataMessage } from './types'
import { saveLog } from '../storage'

// ── Typen ────────────────────────────────────────────────────────

/**
 * Pro Peer halten wir einen Eintrag mit:
 *   - pc:  die RTCPeerConnection vom Browser
 *   - dc:  der zugehörige Datenkanal (kann initial null sein, wenn die
 *          Gegenseite ihn erst erzeugt — siehe pc.ondatachannel)
 *   - state: aktueller Zustand für die UI-Anzeige
 *   - iceCandidateBuffer: ICE-Kandidaten, die ankommen, bevor die
 *          Remote-Description gesetzt ist. Sie können nicht direkt
 *          angewendet werden, weil RTCPeerConnection sonst wirft.
 *   - makingOffer / ignoreOffer: Flags für "Perfect Negotiation",
 *          siehe `handleOffer` weiter unten.
 */
interface PeerEntry {
  pc: RTCPeerConnection
  dc: RTCDataChannel | null
  state: PeerState
  iceCandidateBuffer: RTCIceCandidateInit[]
  makingOffer: boolean
  ignoreOffer: boolean
}

type OnStateChange = (pubkey: string, state: PeerState) => void
type OnDataMessage = (pubkey: string, msg: DataMessage) => void
type OnSignalOut = (signal: SignalMessage) => void

// ── Modulstate ───────────────────────────────────────────────────

let myPubkey: string | null = null
/** pubkey → PeerEntry. Maximal ein Eintrag pro Kontakt. */
const peers = new Map<string, PeerEntry>()

let onStateChange: OnStateChange | null = null
let onDataMessage: OnDataMessage | null = null
let onSignalOut: OnSignalOut | null = null

/** Initialisiert den PeerManager mit der eigenen Identität. */
export function initPeerManager(pubkey: string): void {
  myPubkey = pubkey
}

/**
 * Registriert die drei Callbacks, über die der PeerManager mit der App
 * kommuniziert:
 *   - onStateChange: Verbindungszustand pro Peer (für UI-Indikator)
 *   - onDataMessage: eingehende P2P-Nachrichten
 *   - onSignalOut:   ausgehende Signale (Offer/Answer/ICE), die per
 *                    Nostr an den Peer geschickt werden müssen
 */
export function setPeerCallbacks(cbs: {
  onStateChange?: OnStateChange
  onDataMessage?: OnDataMessage
  onSignalOut?: OnSignalOut
}): void {
  if (cbs.onStateChange) onStateChange = cbs.onStateChange
  if (cbs.onDataMessage) onDataMessage = cbs.onDataMessage
  if (cbs.onSignalOut) onSignalOut = cbs.onSignalOut
}

/** Aktueller Verbindungszustand eines Peers (UI-relevant). */
export function getPeerState(pubkey: string): PeerState {
  return peers.get(pubkey)?.state ?? 'disconnected'
}

/**
 * Schnellprüfung, ob direktes P2P-Senden möglich ist.
 * `dc.readyState === 'open'` ist die einzige sichere Bedingung —
 * `connectionState === 'connected'` reicht nicht, weil der Datenkanal
 * separat aufgehen muss.
 */
export function isPeerConnected(pubkey: string): boolean {
  const entry = peers.get(pubkey)
  return entry?.dc?.readyState === 'open'
}

// ── Verbindungsverwaltung ────────────────────────────────────────

/** Setzt den Status und meldet ihn an die UI weiter. */
function updateState(pubkey: string, state: PeerState): void {
  const entry = peers.get(pubkey)
  if (entry) entry.state = state
  onStateChange?.(pubkey, state)
}

/**
 * Legt eine frische RTCPeerConnection mit den aktuellen ICE-Settings
 * an und verkabelt alle Lifecycle-Handler. Die eigentliche Logik (wer
 * sendet das Offer, wer den Answer) liegt in connectToPeer/handleOffer.
 */
function createPeerEntry(pubkey: string): PeerEntry {
  const pc = new RTCPeerConnection(getIceConfig())
  const entry: PeerEntry = {
    pc,
    dc: null,
    state: 'connecting',
    iceCandidateBuffer: [],
    makingOffer: false,
    ignoreOffer: false,
  }

  // ── ICE-Kandidaten → über Nostr-Signaling senden ──
  // Browser meldet hier potentielle Netzwerk-Adressen, die der andere
  // Peer ausprobieren soll. Wir leiten jede einzelne sofort weiter.
  pc.onicecandidate = (e) => {
    if (e.candidate && myPubkey) {
      onSignalOut?.({
        type: 'ice-candidate',
        from: myPubkey,
        to: pubkey,
        payload: JSON.stringify(e.candidate.toJSON()),
        ts: Date.now(),
      })
    }
  }

  // ── Änderungen am Verbindungszustand ──
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState
    if (s === 'connected') {
      updateState(pubkey, 'connected')
      saveLog('webrtc', `P2P connected to ${pubkey.slice(0, 8)}...`)
    } else if (s === 'disconnected' || s === 'closed') {
      updateState(pubkey, 'disconnected')
      saveLog('webrtc', `P2P disconnected from ${pubkey.slice(0, 8)}...`)
      // Clean up after a delay (might reconnect)
      setTimeout(() => {
        const current = peers.get(pubkey)
        if (current?.pc === pc && (pc.connectionState === 'disconnected' || pc.connectionState === 'closed' || pc.connectionState === 'failed')) {
          cleanupPeer(pubkey)
        }
      }, 10_000)
    } else if (s === 'failed') {
      updateState(pubkey, 'failed')
      saveLog('webrtc', `P2P failed for ${pubkey.slice(0, 8)}...`)
      cleanupPeer(pubkey)
    }
  }

  // ── Incoming data channel (when remote side initiates) ──
  pc.ondatachannel = (e) => {
    setupDataChannel(pubkey, e.channel)
  }

  peers.set(pubkey, entry)
  updateState(pubkey, 'connecting')
  return entry
}

/**
 * Verkabelt einen frischen RTCDataChannel mit unseren Handlern.
 *
 * Wird auf zwei Wegen erreicht:
 *   - Wir sind Anrufer und haben den Channel selbst erzeugt
 *     (createDataChannel in connectToPeer).
 *   - Wir sind Angerufener und der Browser feuert pc.ondatachannel,
 *     weil die Gegenseite den Channel angelegt hat.
 *
 * In beiden Fällen müssen die Event-Handler einmal gesetzt werden.
 */
function setupDataChannel(pubkey: string, dc: RTCDataChannel): void {
  const entry = peers.get(pubkey)
  if (!entry) return

  entry.dc = dc

  dc.onopen = () => {
    updateState(pubkey, 'connected')
    saveLog('webrtc', `Data channel open with ${pubkey.slice(0, 8)}...`)
  }

  dc.onclose = () => {
    saveLog('webrtc', `Data channel closed with ${pubkey.slice(0, 8)}...`)
    // Es kann passieren, dass der Channel kurz schließt und der
    // ConnectionState immer noch 'connected' steht (Browser-Quirk).
    // Wir markieren erst dann disconnected, wenn beides aus ist.
    if (entry.pc.connectionState !== 'connected') {
      updateState(pubkey, 'disconnected')
    }
  }

  dc.onerror = (e) => {
    saveLog('webrtc-error', `Data channel error with ${pubkey.slice(0, 8)}...: ${String(e)}`)
  }

  dc.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data) as DataMessage
      onDataMessage?.(pubkey, msg)
    } catch (err) {
      saveLog('webrtc-error', `Failed to parse data channel message: ${String(err)}`)
    }
  }
}

/** Schließt PeerConnection + DataChannel und entfernt den Eintrag. */
function cleanupPeer(pubkey: string): void {
  const entry = peers.get(pubkey)
  if (!entry) return

  try { entry.dc?.close() } catch { /* ignore */ }
  try { entry.pc.close() } catch { /* ignore */ }
  peers.delete(pubkey)
  updateState(pubkey, 'disconnected')
}

// ── Aktiver Verbindungsaufbau (Anrufer-Seite) ────────────────────

/**
 * Startet eine P2P-Verbindung zu einem Kontakt.
 *
 *   1. Falls schon eine offene oder im Aufbau befindliche Verbindung
 *      existiert, sofort zurück — kein Doppelaufbau.
 *   2. Stale Connections (failed/closed) erst aufräumen.
 *   3. Neue RTCPeerConnection anlegen, DataChannel erzeugen, Offer
 *      bauen, lokale Description setzen, Offer übers Signaling senden.
 *
 * Der Rest (Answer empfangen, ICE austauschen) passiert event-basiert
 * in handleSignal/handleAnswer/handleIceCandidate.
 */
export async function connectToPeer(pubkey: string): Promise<void> {
  if (!myPubkey) return

  // Already connected or connecting
  const existing = peers.get(pubkey)
  if (existing && (existing.state === 'connected' || existing.state === 'connecting')) {
    return
  }

  // Clean up any stale connection
  if (existing) cleanupPeer(pubkey)

  const entry = createPeerEntry(pubkey)

  // Create data channel (caller creates it)
  const dc = entry.pc.createDataChannel('alina-msg', {
    ordered: true,
  })
  setupDataChannel(pubkey, dc)

  // Create and send offer
  try {
    entry.makingOffer = true
    const offer = await entry.pc.createOffer()
    await entry.pc.setLocalDescription(offer)

    onSignalOut?.({
      type: 'offer',
      from: myPubkey,
      to: pubkey,
      payload: JSON.stringify(entry.pc.localDescription),
      ts: Date.now(),
    })

    saveLog('webrtc', `Sent offer to ${pubkey.slice(0, 8)}...`)
  } catch (e) {
    saveLog('webrtc-error', `Failed to create offer: ${String(e)}`)
    cleanupPeer(pubkey)
  } finally {
    entry.makingOffer = false
  }
}

// ── Eingehende Signale verarbeiten ───────────────────────────────

/**
 * Hauptverteiler für Signaling-Nachrichten von der Gegenseite.
 *
 * Implementiert das "Perfect Negotiation"-Muster, mit dem WebRTC-
 * Verbindungen auch dann robust aufgebaut werden, wenn beide Peers
 * gleichzeitig Offers schicken (sog. "glare").
 */
export async function handleSignal(signal: SignalMessage): Promise<void> {
  if (!myPubkey) return
  const peerPubkey = signal.from

  if (signal.type === 'offer') {
    await handleOffer(peerPubkey, signal.payload)
  } else if (signal.type === 'answer') {
    await handleAnswer(peerPubkey, signal.payload)
  } else if (signal.type === 'ice-candidate') {
    await handleIceCandidate(peerPubkey, signal.payload)
  }
}

/**
 * Verarbeitet ein eingehendes Offer.
 *
 * Glare-Behandlung: Wenn wir GERADE selbst ein Offer schicken oder
 * unsere PC nicht im stable-State ist, müssen wir entscheiden, wer
 * "nachgibt". Dazu vergleichen wir lexikografisch die beiden Pubkeys —
 * derjenige mit dem kleineren Wert ist "polite" und rollt sein eigenes
 * Offer zurück, der andere ignoriert das eingehende. So wird ohne
 * Koordination eine eindeutige Reihenfolge etabliert.
 */
async function handleOffer(peerPubkey: string, payload: string): Promise<void> {
  if (!myPubkey) return

  let entry = peers.get(peerPubkey)

  // Polite = wer den lexikografisch kleineren Pubkey hat
  const isPolite = myPubkey < peerPubkey

  if (entry?.makingOffer || entry?.pc.signalingState !== 'stable') {
    if (!isPolite) {
      // Wir sind impolite und beschäftigt → ignorieren
      saveLog('webrtc', `Ignoring offer from ${peerPubkey.slice(0, 8)}... (glare, we're impolite)`)
      return
    }
    // Wir sind polite — rollen unser eigenes Offer zurück und nehmen das eingehende an
    saveLog('webrtc', `Rolling back our offer for ${peerPubkey.slice(0, 8)}... (glare, we're polite)`)
  }

  // Frische PC bei Bedarf — wenn die alte tot ist oder es noch keine gibt
  if (!entry || entry.pc.connectionState === 'failed' || entry.pc.connectionState === 'closed') {
    if (entry) cleanupPeer(peerPubkey)
    entry = createPeerEntry(peerPubkey)
  }

  try {
    const desc = JSON.parse(payload) as RTCSessionDescriptionInit
    await entry.pc.setRemoteDescription(desc)

    // Gepufferte ICE-Kandidaten jetzt anwenden — wir hatten sie nicht
    // direkt verarbeiten können, weil die remoteDescription noch fehlte.
    for (const candidate of entry.iceCandidateBuffer) {
      await entry.pc.addIceCandidate(candidate)
    }
    entry.iceCandidateBuffer = []

    // Answer bauen und zurückschicken
    const answer = await entry.pc.createAnswer()
    await entry.pc.setLocalDescription(answer)

    onSignalOut?.({
      type: 'answer',
      from: myPubkey,
      to: peerPubkey,
      payload: JSON.stringify(entry.pc.localDescription),
      ts: Date.now(),
    })

    saveLog('webrtc', `Sent answer to ${peerPubkey.slice(0, 8)}...`)
  } catch (e) {
    saveLog('webrtc-error', `Failed to handle offer: ${String(e)}`)
    cleanupPeer(peerPubkey)
  }
}

/** Verarbeitet ein eingehendes Answer (auf unser Offer hin). */
async function handleAnswer(peerPubkey: string, payload: string): Promise<void> {
  const entry = peers.get(peerPubkey)
  if (!entry) return

  try {
    const desc = JSON.parse(payload) as RTCSessionDescriptionInit
    await entry.pc.setRemoteDescription(desc)

    // Auch hier: ICE-Kandidaten, die vor dem Answer reinkamen, jetzt anwenden
    for (const candidate of entry.iceCandidateBuffer) {
      await entry.pc.addIceCandidate(candidate)
    }
    entry.iceCandidateBuffer = []

    saveLog('webrtc', `Received answer from ${peerPubkey.slice(0, 8)}...`)
  } catch (e) {
    saveLog('webrtc-error', `Failed to handle answer: ${String(e)}`)
  }
}

/**
 * Verarbeitet einen einzelnen ICE-Kandidaten der Gegenseite.
 *
 * Vor `setRemoteDescription` wirft `addIceCandidate` — daher puffern wir
 * Kandidaten bis dahin. Nach setRemoteDescription werden alle gepufferten
 * Kandidaten abgearbeitet (siehe handleOffer/handleAnswer).
 */
async function handleIceCandidate(peerPubkey: string, payload: string): Promise<void> {
  const entry = peers.get(peerPubkey)
  if (!entry) return

  try {
    const candidate = JSON.parse(payload) as RTCIceCandidateInit

    if (entry.pc.remoteDescription) {
      await entry.pc.addIceCandidate(candidate)
    } else {
      entry.iceCandidateBuffer.push(candidate)
    }
  } catch (e) {
    saveLog('webrtc-error', `Failed to handle ICE candidate: ${String(e)}`)
  }
}

// ── Nachricht direkt P2P senden ──────────────────────────────────

/**
 * Versucht, eine Nachricht über den Datenkanal zu schicken.
 *
 * Liefert true bei Erfolg, false sonst — der Aufrufer (`publishDM` in
 * nostr.ts) nutzt den false-Fall, um auf die Relay-Zustellung
 * umzuschalten.
 */
export function sendViaPeer(pubkey: string, msg: DataMessage): boolean {
  const entry = peers.get(pubkey)
  if (!entry || entry.dc?.readyState !== 'open') {
    return false
  }

  try {
    entry.dc.send(JSON.stringify(msg))
    return true
  } catch (e) {
    saveLog('webrtc-error', `Failed to send via P2P to ${pubkey.slice(0, 8)}...: ${String(e)}`)
    return false
  }
}

// ── Lifecycle ────────────────────────────────────────────────────

/** Trennt sämtliche Verbindungen (bei Logout oder Cleanup). */
export function disconnectAllPeers(): void {
  peers.forEach((_, pubkey) => cleanupPeer(pubkey))
  peers.clear()
  myPubkey = null
}

/**
 * Versucht, zu allen bekannten Kontakten eine P2P-Verbindung
 * aufzubauen. Existierende oder gerade entstehende Verbindungen
 * werden nicht erneut initiiert.
 *
 * Wird vom Hook beim Start (mit Verzögerung, damit Relays vorher
 * verbunden sind) und bei jedem Kontakt-Update aufgerufen.
 */
export function connectToContacts(contactPubkeys: string[]): void {
  for (const pubkey of contactPubkeys) {
    if (!isPeerConnected(pubkey) && getPeerState(pubkey) !== 'connecting') {
      connectToPeer(pubkey).catch(e => {
        saveLog('webrtc-error', `Failed to initiate connection to ${pubkey.slice(0, 8)}...: ${String(e)}`)
      })
    }
  }
}
