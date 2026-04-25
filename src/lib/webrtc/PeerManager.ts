/**
 * PeerManager — manages WebRTC peer connections for all contacts.
 *
 * Each contact gets at most one RTCPeerConnection + RTCDataChannel.
 * Signaling (SDP offer/answer, ICE candidates) goes through Nostr relays.
 * Once the data channel is open, messages flow directly P2P.
 *
 * If P2P fails or the peer is offline, falls back to Nostr relay delivery.
 */

import { getIceConfig } from './iceConfig'
import type { PeerState, SignalMessage, DataMessage } from './types'
import { saveLog } from '../storage'

// ── Types ────────────────────────────────────────────────────────

interface PeerEntry {
  pc: RTCPeerConnection
  dc: RTCDataChannel | null
  state: PeerState
  iceCandidateBuffer: RTCIceCandidateInit[] // Buffered until remote description is set
  makingOffer: boolean
  ignoreOffer: boolean
}

type OnStateChange = (pubkey: string, state: PeerState) => void
type OnDataMessage = (pubkey: string, msg: DataMessage) => void
type OnSignalOut = (signal: SignalMessage) => void

// ── PeerManager ──────────────────────────────────────────────────

let myPubkey: string | null = null
const peers = new Map<string, PeerEntry>()

let onStateChange: OnStateChange | null = null
let onDataMessage: OnDataMessage | null = null
let onSignalOut: OnSignalOut | null = null

/** Initialize the PeerManager with the local identity */
export function initPeerManager(pubkey: string): void {
  myPubkey = pubkey
}

/** Register callbacks */
export function setPeerCallbacks(cbs: {
  onStateChange?: OnStateChange
  onDataMessage?: OnDataMessage
  onSignalOut?: OnSignalOut
}): void {
  if (cbs.onStateChange) onStateChange = cbs.onStateChange
  if (cbs.onDataMessage) onDataMessage = cbs.onDataMessage
  if (cbs.onSignalOut) onSignalOut = cbs.onSignalOut
}

/** Get current state of a peer connection */
export function getPeerState(pubkey: string): PeerState {
  return peers.get(pubkey)?.state ?? 'disconnected'
}

/** Get all peer states */
export function getAllPeerStates(): Record<string, PeerState> {
  const result: Record<string, PeerState> = {}
  peers.forEach((entry, pubkey) => {
    result[pubkey] = entry.state
  })
  return result
}

/** Check if a peer has an open data channel */
export function isPeerConnected(pubkey: string): boolean {
  const entry = peers.get(pubkey)
  return entry?.dc?.readyState === 'open'
}

// ── Connection Management ────────────────────────────────────────

function updateState(pubkey: string, state: PeerState): void {
  const entry = peers.get(pubkey)
  if (entry) entry.state = state
  onStateChange?.(pubkey, state)
}

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

  // ── ICE candidates → send via Nostr signaling ──
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

  // ── Connection state changes ──
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

function cleanupPeer(pubkey: string): void {
  const entry = peers.get(pubkey)
  if (!entry) return

  try { entry.dc?.close() } catch { /* ignore */ }
  try { entry.pc.close() } catch { /* ignore */ }
  peers.delete(pubkey)
  updateState(pubkey, 'disconnected')
}

// ── Initiate Connection (caller side) ────────────────────────────

/**
 * Start a P2P connection to a contact.
 * Creates an SDP offer and sends it via Nostr signaling.
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

// ── Handle Incoming Signals ──────────────────────────────────────

/**
 * Process an incoming signaling message from a peer.
 * Implements "perfect negotiation" pattern to handle glare (simultaneous offers).
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

async function handleOffer(peerPubkey: string, payload: string): Promise<void> {
  if (!myPubkey) return

  let entry = peers.get(peerPubkey)

  // Perfect negotiation: if we're also making an offer, the "polite" peer rolls back
  // Polite = the one with the lower pubkey (deterministic, no coordination needed)
  const isPolite = myPubkey < peerPubkey

  if (entry?.makingOffer || entry?.pc.signalingState !== 'stable') {
    if (!isPolite) {
      // We're impolite and already making an offer — ignore theirs
      saveLog('webrtc', `Ignoring offer from ${peerPubkey.slice(0, 8)}... (glare, we're impolite)`)
      return
    }
    // We're polite — roll back our offer and accept theirs
    saveLog('webrtc', `Rolling back our offer for ${peerPubkey.slice(0, 8)}... (glare, we're polite)`)
  }

  // Create or reuse connection
  if (!entry || entry.pc.connectionState === 'failed' || entry.pc.connectionState === 'closed') {
    if (entry) cleanupPeer(peerPubkey)
    entry = createPeerEntry(peerPubkey)
  }

  try {
    const desc = JSON.parse(payload) as RTCSessionDescriptionInit
    await entry.pc.setRemoteDescription(desc)

    // Flush buffered ICE candidates
    for (const candidate of entry.iceCandidateBuffer) {
      await entry.pc.addIceCandidate(candidate)
    }
    entry.iceCandidateBuffer = []

    // Create and send answer
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

async function handleAnswer(peerPubkey: string, payload: string): Promise<void> {
  const entry = peers.get(peerPubkey)
  if (!entry) return

  try {
    const desc = JSON.parse(payload) as RTCSessionDescriptionInit
    await entry.pc.setRemoteDescription(desc)

    // Flush buffered ICE candidates
    for (const candidate of entry.iceCandidateBuffer) {
      await entry.pc.addIceCandidate(candidate)
    }
    entry.iceCandidateBuffer = []

    saveLog('webrtc', `Received answer from ${peerPubkey.slice(0, 8)}...`)
  } catch (e) {
    saveLog('webrtc-error', `Failed to handle answer: ${String(e)}`)
  }
}

async function handleIceCandidate(peerPubkey: string, payload: string): Promise<void> {
  const entry = peers.get(peerPubkey)
  if (!entry) return

  try {
    const candidate = JSON.parse(payload) as RTCIceCandidateInit

    if (entry.pc.remoteDescription) {
      await entry.pc.addIceCandidate(candidate)
    } else {
      // Buffer until remote description is set
      entry.iceCandidateBuffer.push(candidate)
    }
  } catch (e) {
    saveLog('webrtc-error', `Failed to handle ICE candidate: ${String(e)}`)
  }
}

// ── Send Message via P2P ─────────────────────────────────────────

/**
 * Send a message via WebRTC data channel.
 * Returns true if sent successfully, false if not connected (use relay fallback).
 */
export function sendViaPeer(pubkey: string, msg: DataMessage): boolean {
  const entry = peers.get(pubkey)
  if (!entry || entry.dc?.readyState !== 'open') {
    return false // Not connected — caller should use Nostr relay
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

/** Disconnect all peers (called on logout or cleanup) */
export function disconnectAllPeers(): void {
  peers.forEach((_, pubkey) => cleanupPeer(pubkey))
  peers.clear()
  myPubkey = null
}

/** Attempt P2P connections to all known contacts */
export function connectToContacts(contactPubkeys: string[]): void {
  for (const pubkey of contactPubkeys) {
    // Only connect if not already connected
    if (!isPeerConnected(pubkey) && getPeerState(pubkey) !== 'connecting') {
      connectToPeer(pubkey).catch(e => {
        saveLog('webrtc-error', `Failed to initiate connection to ${pubkey.slice(0, 8)}...: ${String(e)}`)
      })
    }
  }
}
