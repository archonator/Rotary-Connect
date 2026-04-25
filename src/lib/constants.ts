export const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://nostr.mom',
  'wss://nostr.wine',
  'wss://purplepag.es',
  'wss://relay.primal.net',
  'wss://relay.nostr.bg',
] as const

export const EMOJIS = [
  '😊','😂','❤️','👍','🙏','😍','🎉','😢','😎','🔥',
  '💪','✨','🤔','👋','😅','🌹','💙','🫂','😄','🥰',
  '😭','🤣','💯','👏','🎶','🌍','✌️','😇','🤩','💌',
] as const

export const MAX_IMAGE_SIZE = 500 * 1024 // 500 KB
export const MAX_MESSAGES_PER_CHAT = 200
export const INVITE_CODE_DURATION = 600 // seconds
export const INVITE_KIND = 10420 // custom Nostr kind for invite codes
export const SEAL_KIND = 13       // NIP-17: Seal (encrypted rumor)
export const GIFT_WRAP_KIND = 1059 // NIP-17: Gift Wrap (encrypted seal)
export const CHAT_MESSAGE_KIND = 14 // NIP-17: Chat message (rumor inside seal)
export const ROOM_PRESENCE_KIND = 42 // Room join/presence announcement (public, non-sensitive)
export const KEY_MIGRATION_KIND = 10051 // Custom kind: key migration/rotation event
export const WEBRTC_SIGNAL_KIND = 25050 // Ephemeral kind: WebRTC signaling (SDP/ICE)
