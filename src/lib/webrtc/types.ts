/** WebRTC peer connection state */
export type PeerState = 'disconnected' | 'connecting' | 'connected' | 'failed'

/** Signaling message types exchanged over Nostr relays */
export type SignalType = 'offer' | 'answer' | 'ice-candidate'

/** A signaling message sent via Nostr (NIP-04 encrypted) */
export interface SignalMessage {
  type: SignalType
  from: string     // sender pubkey
  to: string       // recipient pubkey
  payload: string  // JSON-serialized SDP or ICE candidate
  ts: number       // timestamp
}

/** Internal event for the PeerManager */
export interface PeerEvent {
  type: 'state-change' | 'message'
  pubkey: string
  state?: PeerState
  data?: string
}

/** Message sent over a WebRTC data channel */
export interface DataMessage {
  chatId: string
  msgData: { type: string; content: string; name?: string }
  eventId?: string
  ts: number
}
