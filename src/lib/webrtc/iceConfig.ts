/**
 * ICE-Server-Konfiguration für WebRTC NAT-Traversal.
 *
 * WebRTC braucht "Hilfsserver" (ICE-Server), um zwei Browser hinter
 * verschiedenen NATs/Firewalls zueinander finden zu lassen:
 *
 *   • STUN — sagt dem Browser nur, wie seine eigene öffentliche IP
 *     aussieht. Der eigentliche Datenstrom läuft trotzdem direkt.
 *     Quasi gratis (Google/Mozilla bieten kostenlose STUN-Server),
 *     aber funktioniert nicht durch alle NATs (z. B. nicht durch
 *     symmetrisches NAT).
 *
 *   • TURN — leitet den ganzen Verkehr über einen Vermittlungsserver.
 *     Funktioniert in fast jedem Netzwerk, kostet aber Bandbreite und
 *     erfordert einen eigenen oder bezahlten TURN-Server.
 *
 * Modi:
 *   "standard" — Nur STUN, direkter P2P-Versuch. Schnell, aber Peers
 *                sehen die IP-Adresse des anderen.
 *   "private"  — Nur TURN-Relay. IPs bleiben verborgen, erfordert
 *                aber einen vom Nutzer konfigurierten TURN-Server.
 */

export type WebRTCMode = 'standard' | 'private'

export interface TurnConfig {
  url: string
  username: string
  credential: string
}

// ── localStorage-Keys (nicht-sensible Einstellungen, kein Vault) ─

const MODE_KEY = 'alina-webrtc-mode'
const TURN_URL_KEY = 'alina-turn-url'
const TURN_USER_KEY = 'alina-turn-user'
const TURN_PASS_KEY = 'alina-turn-pass'

// ── Lesen/Schreiben der Einstellungen ────────────────────────────

export function getWebRTCMode(): WebRTCMode {
  return (localStorage.getItem(MODE_KEY) as WebRTCMode) || 'standard'
}

export function setWebRTCMode(mode: WebRTCMode): void {
  localStorage.setItem(MODE_KEY, mode)
}

export function getTurnConfig(): TurnConfig {
  return {
    url: localStorage.getItem(TURN_URL_KEY) || '',
    username: localStorage.getItem(TURN_USER_KEY) || '',
    credential: localStorage.getItem(TURN_PASS_KEY) || '',
  }
}

export function setTurnConfig(config: TurnConfig): void {
  localStorage.setItem(TURN_URL_KEY, config.url)
  localStorage.setItem(TURN_USER_KEY, config.username)
  localStorage.setItem(TURN_PASS_KEY, config.credential)
}

// ── ICE-Konfiguration zusammenbauen ──────────────────────────────

/**
 * Liste der STUN-Server, die wir standardmäßig verwenden.
 * Mehrere Anbieter (Google + Mozilla), damit ein Ausfall nicht die
 * ganze NAT-Erkennung blockiert.
 */
const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.services.mozilla.com' },
]

/**
 * Baut die aktuelle ICE-Konfiguration basierend auf Modus und TURN-
 * Einstellungen zusammen. Wird beim Erzeugen jeder neuen
 * RTCPeerConnection aufgerufen.
 */
export function getIceConfig(): RTCConfiguration {
  const mode = getWebRTCMode()
  const turn = getTurnConfig()
  const hasTurn = turn.url.length > 0

  const iceServers: RTCIceServer[] = [...STUN_SERVERS]

  if (hasTurn) {
    iceServers.push({
      urls: turn.url,
      username: turn.username,
      credential: turn.credential,
    })
  }

  return {
    iceServers,
    iceCandidatePoolSize: 2, // sammelt vorab 2 Kandidaten, beschleunigt Setup
    // Im Privacy-Modus zwingen wir TURN-only ("relay"), sodass weder
    // direkte P2P-Adressen noch reflexive STUN-Adressen ausgetauscht
    // werden. Die IPs der Peers bleiben füreinander unsichtbar.
    ...(mode === 'private' && hasTurn ? { iceTransportPolicy: 'relay' } : {}),
  }
}
