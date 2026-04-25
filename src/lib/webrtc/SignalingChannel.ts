/**
 * SignalingChannel — routes WebRTC signaling through Nostr relays.
 *
 * SDP offers/answers and ICE candidates are encrypted with NIP-04
 * and sent as ephemeral Nostr events (Kind 25050).
 * This way, no additional signaling server is needed.
 */

import { WEBRTC_SIGNAL_KIND } from '../constants'
import { encryptDM, decryptDM, createSignedEvent, isValidEvent } from '../crypto'
import { publishToRelays } from '../nostr'
import { saveLog } from '../storage'
import { handleSignal } from './PeerManager'
import type { SignalMessage } from './types'

// ── Send Signal via Nostr ────────────────────────────────────────

/**
 * Encrypt and publish a signaling message to Nostr relays.
 * The signal is NIP-04 encrypted so only the recipient can read it.
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

// ── Receive Signal from Nostr ────────────────────────────────────

/**
 * Handle an incoming signaling event from Nostr.
 * Decrypts the NIP-04 payload and passes it to PeerManager.
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

    // Ignore old signals (> 60 seconds)
    const age = Date.now() - data.ts
    if (age > 60_000) {
      saveLog('webrtc-signal', `Ignoring stale signal from ${fromPubkey.slice(0, 8)}... (${Math.round(age / 1000)}s old)`)
      return
    }

    const signal: SignalMessage = {
      type: data.type,
      from: fromPubkey,
      to: myPubkey,
      payload: data.payload,
      ts: data.ts,
    }

    await handleSignal(signal)
  } catch (e) {
    saveLog('webrtc-signal', `Failed to handle signal from ${fromPubkey.slice(0, 8)}...: ${String(e)}`)
  }
}
