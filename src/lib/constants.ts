/**
 * Globale Konstanten der App.
 *
 * Hier landet alles, was an mehreren Stellen referenziert wird, damit
 * Magic Numbers und URLs nicht im Code verstreut sind.
 */

/**
 * Standardliste der Nostr-Relays.
 *
 * Beim Start verbindet sich die App parallel mit allen sieben Relays.
 * Mehr Relays = höhere Zustellrate, aber auch mehr Datenverkehr und mehr
 * Kopien einer Nachricht (die der Empfänger dann deduplizieren muss).
 *
 * Falls einer dieser Relays mal abgeschaltet wird, einfach hier streichen
 * oder durch einen anderen ersetzen — die App kommt mit beliebigen
 * öffentlichen Nostr-Relays zurecht.
 */
export const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://nostr.mom',
  'wss://nostr.wine',
  'wss://purplepag.es',
  'wss://relay.primal.net',
  'wss://relay.nostr.bg',
] as const

/**
 * Auswahl, die im Emoji-Picker im Chat-Input gezeigt wird.
 * Bewusst klein gehalten, damit der Picker auf Mobilgeräten in einen
 * Screen passt und keine eigene Bibliothek erfordert.
 */
export const EMOJIS = [
  '😊','😂','❤️','👍','🙏','😍','🎉','😢','😎','🔥',
  '💪','✨','🤔','👋','😅','🌹','💙','🫂','😄','🥰',
  '😭','🤣','💯','👏','🎶','🌍','✌️','😇','🤩','💌',
] as const

/**
 * Maximale Größe eines Bildanhangs in Bytes (Base64-codiert).
 * Wird in `ImagePreview.compressImage()` so weit komprimiert, dass die
 * Base64-Repräsentation diese Schwelle unterschreitet — sonst lehnt das
 * Relay die Nachricht u. U. wegen Größe ab.
 */
export const MAX_IMAGE_SIZE = 500 * 1024 // 500 KB

/**
 * Wie viele Nachrichten wir pro Chat lokal aufheben.
 * Ältere Nachrichten werden vorne abgeschnitten — die App ist als
 * "rolling history"-Messenger konzipiert, nicht als Archiv.
 */
export const MAX_MESSAGES_PER_CHAT = 200

/**
 * Lebenszeit eines Einladungscodes in Sekunden (10 Minuten).
 * Sowohl der Inviter (Expiration-Tag) als auch der Empfänger (since-Filter)
 * verwenden diesen Wert, damit beide Seiten dasselbe Fenster sehen.
 */
export const INVITE_CODE_DURATION = 600

// ── Nostr-Event-Kinds ────────────────────────────────────────────
//
// Jedes Nostr-Event hat ein Kind (= Nummer), das angibt, was es ist.
// Die Standard-Kinds sind in den NIPs (Nostr Implementation Possibilities)
// dokumentiert, eigene Kinds (>= 10000) sind anwendungsspezifisch.

/** Custom: Einladungscode-Event (siehe ARCHITECTURE.md, Abschnitt Invite Codes) */
export const INVITE_KIND = 10420

/** NIP-17: Seal — verschlüsseltes Rumor, signiert vom Sender */
export const SEAL_KIND = 13

/** NIP-17: Gift Wrap — verschlüsselter Seal, signiert mit ephemerem Schlüssel */
export const GIFT_WRAP_KIND = 1059

/** NIP-17: Chat-Message-Rumor (im Seal eingebettet, nie alleine veröffentlicht) */
export const CHAT_MESSAGE_KIND = 14

/**
 * Raum-Presence-Event (Kind 42).
 * Wird ursprünglich in NIP-28 für Public-Chat verwendet, hier zweckentfremdet
 * als reine "Ich bin in diesem Raum"-Ankündigung. Inhalt: nur der Anzeigename
 * — keine eigentliche Nachricht.
 */
export const ROOM_PRESENCE_KIND = 42

/** Custom: Schlüsselrotations-/Migrations-Event (alter und neuer Key signieren sich gegenseitig) */
export const KEY_MIGRATION_KIND = 10051

/**
 * Custom-Ephemeral: WebRTC-Signaling.
 * Trägt SDP-Offers/Answers und ICE-Kandidaten zwischen zwei Browsern.
 * Ephemer = wird vom Relay nicht persistiert; landet nur bei aktuell
 * verbundenen Empfängern.
 */
export const WEBRTC_SIGNAL_KIND = 25050
