/**
 * Typdefinitionen für die WebRTC-Schicht.
 *
 * Hier liegen nur die Typen, keine Logik — `PeerManager.ts` und
 * `SignalingChannel.ts` importieren sie. Separates Modul, damit auch
 * andere Stellen (z. B. der Store für die Anzeige des Verbindungs-
 * status) sie referenzieren können, ohne den WebRTC-Code zu laden.
 */

/**
 * Verbindungszustand zu einem einzelnen Peer.
 *   • disconnected — keine offene Verbindung
 *   • connecting   — SDP-Austausch läuft, ICE-Kandidaten fließen
 *   • connected    — RTCDataChannel offen, Nachrichten möglich
 *   • failed       — ICE-Verhandlung gescheitert (NAT, Firewall, …)
 */
export type PeerState = 'disconnected' | 'connecting' | 'connected' | 'failed'

/**
 * Drei Arten von Signaling-Nachrichten zwischen den Peers:
 *   • offer          — initiales Angebot des Anrufers
 *   • answer         — Antwort des Angerufenen
 *   • ice-candidate  — Netzwerk-Adressen-Vorschlag (mehrere pro Verbindung)
 */
export type SignalType = 'offer' | 'answer' | 'ice-candidate'

/**
 * Eine Signaling-Nachricht. Wird in `SignalingChannel` mit NIP-04
 * verschlüsselt und als Kind-25050-Event über Nostr versendet.
 *
 * `payload` ist ein JSON-String (entweder ein RTCSessionDescriptionInit
 * oder ein RTCIceCandidateInit), damit das Format unabhängig von
 * Browser-internen Klassen serialisierbar bleibt.
 */
export interface SignalMessage {
  type: SignalType
  from: string     // Sender-Pubkey (hex)
  to: string       // Empfänger-Pubkey (hex)
  payload: string  // SDP oder ICE-Kandidat als JSON-String
  ts: number       // Sender-Zeitstempel (informativ, der Empfänger
                   // verlässt sich auf event.created_at, siehe
                   // SignalingChannel.handleSignalingEvent)
}

/**
 * Internes Event-Format des PeerManagers — aktuell nicht außerhalb
 * verwendet, kann aber für zukünftige Event-Bus-Integration nützlich
 * sein (z. B. wenn das WebRTC-Modul mehr State raushebt).
 */
export interface PeerEvent {
  type: 'state-change' | 'message'
  pubkey: string
  state?: PeerState
  data?: string
}

/**
 * Nachrichtenformat im offenen RTCDataChannel zwischen zwei Peers.
 *
 * `chatId` enthält aus Sender-Sicht den eigenen Pubkey ("dm:<self>"),
 * damit der Empfänger den Chat unter "dm:<senderPubkey>" einsortiert.
 * (Das ist symmetrisch zum DM-Empfangs-Code für relay-basierte DMs.)
 */
export interface DataMessage {
  chatId: string
  msgData: { type: string; content: string; name?: string }
  eventId?: string
  ts: number
}
