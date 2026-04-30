# Roadmap

## Shipped

- [x] End-to-end encrypted direct messages (NIP-04)
- [x] End-to-end encrypted group rooms (NIP-17 Seal + Gift Wrap)
- [x] WebRTC P2P with Nostr signaling, polite-peer perfect negotiation
- [x] WebRTC privacy modes (Standard / Private with TURN)
- [x] Local vault: PIN → PBKDF2 → KEK → non-extractable DEK → AES-GCM at rest
- [x] PIN change without bulk re-encryption
- [x] Invite-code contact flow (6-digit, kind 10420, SHA-256 hashed)
- [x] Add contact via `npub`
- [x] Image messages (compressed, ≤ 500 KB)
- [x] Location messages (lat / lng + static map)
- [x] Disappearing messages with per-message TTL
- [x] Offline queue with vault-encrypted persistence
- [x] Auto-translation (Chrome AI primary, MyMemory opt-in fallback)
- [x] Key rotation — sender side (kind 10051 with cross-signature)
- [x] Relay status indicator + auto-reconnect with exponential backoff
- [x] PWA install (iOS / Android / desktop)
- [x] Mobile-first UI (sidebar, swipe gestures, mobile splash)
- [x] In-app diagnostic log
- [x] Bilingual UI (DE / EN)

---

## Planned

### Receiver-side key migration auto-update
Verified key migration events (kind 10051) currently log but don't auto-update the contact's pubkey. Wiring `setOnMigration` into the store so the UI can prompt the user to confirm and rotate the contact entry safely.

### Russian (ru) translations
Mentioned historically; not currently in `i18n.ts`. Add a third dictionary and corresponding `formatTime` locale entry.

### QR code contact flow
Show a QR encoding the invite code (and optionally the inviter's `npub` for direct add) so two people in the same room can connect without typing.
- Tech: `qrcode` + `html5-qrcode` (or browser BarcodeDetector where available).

### Voice messages
Press-to-record button → MediaRecorder → encrypt → send. Plays inline with seek bar.

### Stronger PIN gate
- Exponential lockout (60 s → 5 min → 1 h → 24 h).
- Optional WebAuthn / platform authenticator (Touch ID / Face ID / Windows Hello) as a second unlock factor that wraps the KEK.
- Reject obvious weak PINs (`0000`, `1234`, `1111`, …) at setup.

### Hardened transport headers
Move CSP from `<meta>` into Vercel response headers and add HSTS, X-Frame-Options, COOP / CORP. Whitelist relay URLs in `connect-src` instead of bare `wss:`.

### Better dedup for room messages
Use the inner Seal ID (`seal.id`) for deduplication so the same message gift-wrapped to multiple recipients via multiple relays only stores once.

### Larger group support
Either (a) cap rooms at a small N with UI feedback, or (b) introduce a per-room shared symmetric key (NIP-17-style group session) so cost stops scaling per-recipient.

### Offline-queue retry policy
Per-message retry counter, exponential backoff, dead-letter after N attempts so a single bad message can't block the queue.

### CRDT / multi-device sync
Same identity on phone + desktop without losing history. Likely via NIP-44 self-encrypted backup events.
