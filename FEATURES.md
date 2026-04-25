# Features

## Shipped

### Identity & Keys
- No account, no phone number, no email — just a cryptographic key pair
- Private key stays exclusively on the user's device
- Keys importable via `nsec` (NIP-19)
- Display name changeable at any time in Settings

### Direct Messages
- End-to-end encrypted with NIP-04 (ECDH + AES-256-CBC)
- Invite-based: 6-digit one-time codes (Nostr kind 10420, SHA-256 hashed)
- Inviter embeds their name in the event → recipient immediately sees who sent the invite
- Contacts can be renamed and deleted (including chat history)

### Group Rooms
- Open rooms via Nostr kind 42
- Join by entering the same group name — no central server
- After creation: group name shown with copy button + join instructions

### Messages
- Text, images (up to 500 KB, base64), location (what3words)
- Timestamps: today = time only, yesterday = "Yesterday HH:MM", older = date + time
- Unread badge per chat

### Auto-Translation
- Foreign language messages are translated client-side — plaintext never leaves the device unencrypted
- Primary: Chrome AI Translation API (Chrome 127+) — fully offline, no API key
- Fallback: MyMemory API (free, no key required)
- Translations cached in localStorage → no repeated API calls
- "Show original" toggle per message
- Enable / disable in Settings

### Multilingual UI
- German, English, Russian
- Language switcher on the setup screen (before login) and in Settings
- Language preference persisted in localStorage

### Relay Status
- Live indicator for connected relays (red / yellow / green dot)
- Automatic reconnection

### PWA Install Prompt
- Native-looking install dialog for iOS (step-by-step guide), Android, and Desktop
- Install button appears in the sidebar only when the browser signals the app is installable
- Powered by [@khmyznikov/pwa-install](https://github.com/khmyznikov/pwa-install)

---

## Roadmap

### QR Code Contact Sharing
Instead of typing a 6-digit code — show a QR code, the other person scans it. Ideal for in-person meetings.
- Technology: `qrcode.react` + `html5-qrcode`

### Voice Messages
Microphone button → record → send. Especially useful for users who prefer talking over typing.
- Technology: `MediaRecorder` API → base64 → sent as a message

### Disappearing Messages
Set an expiry time per chat or per message (e.g. 24h, 7 days). Local cleanup on load.
- Aligns with Alina's privacy-first positioning

### App Lock with PIN
Enter a PIN when opening the app. Optionally fingerprint / Face ID on supported devices.
