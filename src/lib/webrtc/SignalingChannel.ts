/**
 * SignalingChannel — routet WebRTC-Signaling über Nostr-Relays.
 *
 * Üblicherweise braucht WebRTC einen separaten Signaling-Server,
 * über den die zwei Peers ihre SDP-Offers/Answers und ICE-Kandidaten
 * austauschen. Wir umgehen das, indem wir diese Daten:
 *
 *   1. mit NIP-04 (ECDH + AES) für den Empfänger verschlüsseln,
 *   2. in ein ephemeres Nostr-Event (Kind 25050) verpacken,
 *   3. über die ohnehin offenen Relay-Verbindungen senden.
 *
 * Vorteil: Kein zusätzlicher Server, keine zentrale Stelle, die mitsehen
 * könnte. Nachteil: Latenz und Reichweite hängen vom Relay-Status ab —
 * aber für ein Setup, das nur Sekunden dauert, ist das tolerierbar.
 */

import { WEBRTC_SIGNAL_KIND } from '../constants'
import { encryptDM, decryptDM, createSignedEvent } from '../crypto'
import { publishToRelays } from '../nostr'
import { saveLog } from '../storage'
import { handleSignal } from './PeerManager'
import type { SignalMessage } from './types'

// ── Signal über Nostr senden ─────────────────────────────────────

/**
 * Verschlüsselt eine Signaling-Nachricht und veröffentlicht sie als
 * Kind-25050-Event. Nur der Empfänger (signal.to) kann sie lesen,
 * weil NIP-04 zum Verschlüsseln dessen Pubkey benutzt.
 */
export async function sendSignal(
  privkey: Uint8Array,
  myPubkey: string,
  signal: SignalMessage,
): Promise<void> {
  try {
    const payload = JSON.stringify({
      type: signal.type,
      payload: signal.payload,
      ts: signal.ts,
    })

    const encrypted = await encryptDM(privkey, signal.to, payload)

    const event = createSignedEvent({
      kind: WEBRTC_SIGNAL_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', signal.to]],
      content: encrypted,
      pubkey: myPubkey,
    }, privkey)

    publishToRelays(event)
  } catch (e) {
    saveLog('webrtc-signal', `Failed to send signal to ${signal.to.slice(0, 8)}...: ${String(e)}`)
  }
}

// ── Signal vom Nostr empfangen ───────────────────────────────────

/**
 * Verarbeitet ein eingehendes Kind-25050-Event:
 *
 *   1. Entschlüsselt den NIP-04-Payload mit dem eigenen privkey.
 *   2. Verwirft "abgestandene" Signale: alles, was älter als 60 s
 *      oder mehr als 10 s in der Zukunft liegt — ein Replay alter
 *      Signale könnte sonst eine WebRTC-Verbindung in einen
 *      ungewollten Zustand zwingen.
 *   3. Wichtig: für die Altersprüfung verwenden wir `event.created_at`
 *      (das ist signiert), nicht `data.ts` aus dem Payload (das ist
 *      vom Sender im Klartext setzbar und damit fälschbar).
 *   4. Übergibt das Signal an den PeerManager, der die SDP/ICE-Logik
 *      übernimmt.
 */
export async function handleSignalingEvent(
  privkey: Uint8Array,
  myPubkey: string,
  event: { pubkey: string; content: string; created_at: number },
): Promise<void> {
  const fromPubkey = event.pubkey
  if (fromPubkey === myPubkey) return // Ignore own signals

  try {
    const decrypted = await decryptDM(privkey, fromPubkey, event.content)
    const data = JSON.parse(decrypted)

    // Use the OUTER signed Nostr event timestamp for staleness, not the (untrusted)
    // inner payload — otherwise an attacker could replay a stale signal by repacking
    // it with a fresh inner ts.
    const eventTs = event.created_at * 1000
    const age = Date.now() - eventTs
    if (age > 60_000 || age < -10_000) {
      saveLog('webrtc-signal', `Ignoring stale/future signal from ${fromPubkey.slice(0, 8)}... (${Math.round(age / 1000)}s)`)
      return
    }

    const signal: SignalMessage = {
      type: data.type,
      from: fromPubkey,
      to: myPubkey,
      payload: data.payload,
      ts: eventTs,
    }

    await handleSignal(signal)
  } catch (e) {
    saveLog('webrtc-signal', `Failed to handle signal from ${fromPubkey.slice(0, 8)}...: ${String(e)}`)
  }
}
