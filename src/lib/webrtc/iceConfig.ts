/**
 * ICE server configuration for WebRTC NAT traversal.
 *
 * Two modes:
 *   "standard" — STUN only, direct P2P. Fast, but peers see each other's IP.
 *   "private"  — TURN relay only. Hides IPs, but needs a TURN server configured.
 */

export type WebRTCMode = 'standard' | 'private'

export interface TurnConfig {
  url: string
  username: string
  credential: string
}

// ── localStorage keys (non-sensitive settings, not encrypted) ────

const MODE_KEY = 'alina-webrtc-mode'
const TURN_URL_KEY = 'alina-turn-url'
const TURN_USER_KEY = 'alina-turn-user'
const TURN_PASS_KEY = 'alina-turn-pass'

// ── Read/write settings ──────────────────────────────────────────

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

// ── Build ICE configuration ──────────────────────────────────────

const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.services.mozilla.com' },
]

/**
 * Build the active ICE configuration based on current settings.
 * Call this when creating new peer connections.
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
    iceCandidatePoolSize: 2,
    // In private mode, only use TURN relay — never direct P2P
    // This hides both peers' IP addresses from each other
    ...(mode === 'private' && hasTurn ? { iceTransportPolicy: 'relay' } : {}),
  }
}
