# Features

## Identity & keys

- **No account required.** No phone number, no email, no username — just a secp256k1 key pair generated on first launch.
- **Restore from `nsec`.** Existing Nostr identities can be imported during setup.
- **Editable display name.** Changeable any time in Settings.
- **Key rotation.** Settings → Rotate Key generates a new key pair, publishes a cross-signed migration event (kind 10051), and notifies all contacts via NIP-04 DM. (Receiver-side auto-update is on the roadmap.)

## Local data security

- **Vault.** All sensitive `localStorage` values are encrypted at rest with AES-256-GCM.
- **PIN-derived key.** PBKDF2-SHA256 with 600 000 iterations and a 32-byte salt produces the KEK; the DEK is generated once, stored encrypted, and held in memory as a non-extractable WebCrypto key.
- **Lockout.** 5 wrong PINs → 60 s cool-down (UI-side hint, not cryptographic).
- **Change PIN.** Re-wraps the DEK only; data stays in place.

## Direct messages

- **NIP-04 encrypted** (ECDH + AES-256-CBC). Relays see only ciphertext.
- **Optional WebRTC P2P.** When the recipient is online, messages flow directly over an `RTCDataChannel` and skip relays entirely. Falls back to relays automatically.
- **Delivery status.** Sending → sent → failed (with retry button).
- **Add contacts** via 6-digit one-time invite codes (kind 10420, SHA-256 hashed) **or** by pasting an `npub`.
- **Rename / delete** contacts (deletion also removes the chat history locally).

## Group rooms

- **NIP-17 sealed + gift-wrapped.** Per-recipient encryption (kinds 13 + 1059) with ephemeral wrap keys.
- **Join by name.** Anyone who enters the same room name (case-insensitive, hashed to a deterministic ID) joins the same chat.
- **Member discovery** via lightweight kind-42 presence events. New members announce themselves so others can include them in future gift wraps.

## Messages

- **Types**: text, images (compressed to ≤ 500 KB JPEG, max 800 px side), location (lat/lng with static map preview).
- **Disappearing messages.** Per-message TTL: 30 s, 5 min, 30 min, 1 h, 24 h. Expired messages are pruned client-side every second.
- **Search** within a chat (text messages).
- **Emoji picker.**
- **Image lightbox.**
- **Per-message timestamp** with locale-aware "today / yesterday / older" formatting.
- **Unread badge** per chat.

## Network

- **7 default relays** with exponential-backoff reconnection (5 s → 120 s).
- **Live relay indicator** (red / yellow / green dot in the sidebar).
- **Offline queue.** Compose and "send" while offline; messages are queued (vault-encrypted) and flushed when relays come back.

## WebRTC privacy modes

- **Standard mode.** STUN-only. Direct P2P; peers see each other's IP.
- **Private mode.** TURN-only (`iceTransportPolicy: 'relay'`) with user-supplied TURN credentials. Hides IP at the cost of needing a TURN server.

## Auto-translation

- **Client-side.** Decryption happens before translation — plaintext never leaves the device unencrypted unless the user opts in to the external fallback.
- **Primary**: Chrome AI Translation API (Chrome 127+) — fully offline, no API key.
- **Optional fallback**: MyMemory API (free, no key). Disabled by default; toggle in Settings.
- **Cached** in `localStorage` per (text, targetLang) — no repeated API calls.
- **"Show original" toggle** per message.

## UI

- **Two languages**: German, English (Russian planned).
- **Light branding**: Rotary blue + gold.
- **Mobile-first.** Sidebar slide-in, swipe-to-open, mobile-optimised splash and install banner.
- **Status bar** for transient confirmations.
- **Confirm dialogs** for destructive actions (logout, delete contact, key rotation).

## PWA

- **Installable** on iOS, Android, and desktop.
- **Custom install banner** + native dialog wrapper via `@khmyznikov/pwa-install`.
- **Offline app shell** via Workbox (CacheFirst).
- **Service worker** with auto-update.

## Diagnostics

- **In-app debug log** (ring buffer, 100 entries, plaintext). Accessible from Settings → 🪲 Logs. Captures relay connect/disconnect events, decrypt failures, WebRTC state changes, and unhandled errors.
- **Copy / clear** logs for support.

---

See [ROADMAP.md](./ROADMAP.md) for what's next.
