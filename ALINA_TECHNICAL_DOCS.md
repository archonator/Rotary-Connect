# Alina Chat — Technical Documentation

**Version:** 2.0.0
**Stack:** React 19 + TypeScript + Vite + Nostr Protocol
**Live:** https://alina-chat-tau.vercel.app
**License:** MIT

---

## Why Alina exists

Most messengers require a phone number, an email address, or an account on someone else's server. That means someone always owns your data — a company, a government, a sysadmin.

Alina was built for people who want to message privately without handing over personal information. No sign-up. No phone number. No server that stores your messages. You pick a name, you get a key, you chat. That's it.

The target audience is family and friends — not crypto enthusiasts. The UX is deliberately simple. Technical concepts like "public keys" are hidden behind plain language ("sharing code").

---

## Architecture Overview

Alina is a **client-only PWA**. There is no backend server. Messages travel through public **Nostr relays** — encrypted before they leave the browser. Relays can't read message contents. If every relay disappears, you only lose delivery — never your identity or data.

```
┌──────────────┐       encrypted       ┌──────────────┐
│  Browser A   │ ◄──────────────────► │  Nostr Relay  │
│  (Alina PWA) │      WebSocket        │  (dumb pipe)  │
└──────────────┘                       └───────┬───────┘
                                               │
                                       ┌───────┴───────┐
                                       │  Nostr Relay   │
                                       └───────┬───────┘
                                               │
┌──────────────┐       encrypted       ┌───────┴───────┐
│  Browser B   │ ◄──────────────────► │  Nostr Relay  │
│  (Alina PWA) │      WebSocket        │  (dumb pipe)  │
└──────────────┘                       └──────────────┘
```

**Key principle:** Relays are interchangeable. They never see plaintext. They just forward encrypted blobs.

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| UI Framework | React 19 | Component rendering |
| Language | TypeScript (strict) | Type safety |
| Build | Vite 6 | Dev server, bundling |
| PWA | vite-plugin-pwa + Workbox | Offline support, install prompt |
| State | Zustand 5 | Global state management |
| Protocol | nostr-tools 2.10 | Nostr event signing, encryption |
| Routing | react-router-dom 7 | Landing page ↔ App |
| Icons | lucide-react | UI icons |
| Deployment | Vercel | Hosting, CDN |

---

## Project Structure

```
src/
├── App.tsx                    # Root component, splash → setup → main app
├── main.tsx                   # React entry point
├── lib/
│   ├── constants.ts           # Relay URLs, kinds, limits
│   ├── crypto.ts              # Key generation, NIP-04/NIP-44 encryption, signing
│   ├── nostr.ts               # Relay connections, subscriptions, message handling
│   ├── storage.ts             # localStorage persistence layer
│   ├── offlineQueue.ts        # Queue messages when offline, flush on reconnect
│   ├── translate.ts           # Auto-translate (Chrome AI + MyMemory fallback)
│   ├── i18n.ts                # EN/RU translations
│   ├── logger.ts              # Debug logging
│   └── utils.ts               # Helpers
├── store/
│   └── useStore.ts            # Zustand store (identity, contacts, rooms, messages)
├── hooks/
│   ├── useNostrRelays.ts      # Connect/disconnect relays on mount
│   ├── useEphemeralCleanup.ts # Auto-delete expired disappearing messages
│   └── useT.ts                # Translation hook (returns t() function)
├── components/
│   ├── landing/               # Public landing page
│   ├── setup/                 # First-run setup (name entry, optional key import)
│   ├── chat/                  # Chat area (messages, input, header)
│   ├── sidebar/               # Contact list, room list, chat list
│   ├── modals/                # Add contact, add room, settings
│   └── ui/                    # Splash, avatar, language toggle, lightbox, PWA banner
├── styles/
│   └── index.css              # All styles (app + landing page)
└── __tests__/                 # Unit tests (crypto, storage, store)
```

---

## What is Nostr?

Nostr stands for **"Notes and Other Stuff Transmitted by Relays"**. It's an open protocol — not a company, not an app, not a blockchain. Just a simple set of rules for how clients and relays talk to each other.

### The core idea

Traditional messengers work like this: you send a message to a server, the server stores it, the server delivers it. The server is in control. If the company shuts down or bans you, you lose access.

Nostr flips this. There is no central server. Instead there are **relays** — simple WebSocket servers that accept messages and forward them. Anyone can run a relay. Clients connect to multiple relays at once. If one relay goes offline, the others still work.

The protocol is intentionally minimal. A Nostr event is just a JSON object with a few fields: who sent it (public key), what type it is (kind number), when it was sent (timestamp), and the content. That's it. Everything else — encryption, contacts, group chats, profiles — is built on top of this with optional extensions called NIPs.

### Key concepts

**Identity = Key Pair.** Your identity on Nostr is a secp256k1 key pair — the same elliptic curve Bitcoin uses. Your public key is your address. Your private key proves you are you. There is no username/password, no email, no phone number. If you lose your private key, your identity is gone. There's nobody to call.

**Events.** Everything on Nostr is an "event" — a signed JSON object. A text post is an event. A DM is an event. A profile update is an event. Every event has a `kind` number that says what type it is (kind 0 = profile metadata, kind 1 = text note, kind 4 = encrypted DM, etc.).

**Relays.** Relays are dumb pipes. They receive events, store them (some temporarily, some permanently), and forward them to subscribers. Relays don't know what's inside encrypted events. They can choose to filter or reject events, but they can't forge them — every event is cryptographically signed.

**Subscriptions.** A client sends a filter to a relay ("give me all kind 4 events tagged with my public key") and the relay streams matching events back over the WebSocket connection. This is how you receive messages.

**NIPs (Nostr Implementation Possibilities).** NIPs are numbered proposals that extend the base protocol. They're like RFCs but less formal. Some are widely adopted, some are experimental. Alina uses several of them.

### Event structure

Every Nostr event looks like this:

```json
{
  "id": "sha256 hash of the serialized event",
  "pubkey": "sender's public key (hex)",
  "created_at": 1234567890,
  "kind": 4,
  "tags": [["p", "recipient pubkey"], ...],
  "content": "encrypted or plaintext content",
  "sig": "schnorr signature over the event"
}
```

The `id` is deterministic — it's the SHA-256 of `[0, pubkey, created_at, kind, tags, content]`. This means events can't be tampered with. The `sig` proves the event was created by the owner of `pubkey`.

### Key encoding (NIP-19)

Raw keys are hex strings (64 characters). For human use, Nostr defines Bech32-encoded formats:

- **nsec** → private key (e.g., `nsec1abc...`). Starts with "nsec1". Never share this.
- **npub** → public key (e.g., `npub1xyz...`). Starts with "npub1". This is your address.

Alina uses these for key import/export in settings. In the UI they're called "secret key" and "sharing code" to avoid jargon.

### Why Nostr instead of Signal/Matrix/XMPP?

- **No registration.** Signal needs a phone number. Matrix needs an account on a homeserver. Nostr needs nothing.
- **No single point of failure.** If Signal's server goes down, nobody can message. If one Nostr relay goes down, the others keep working.
- **Portable identity.** Your key pair works on any Nostr client. You can use Alina, Damus, Amethyst, or any other client with the same identity.
- **Censorship resistance.** Nobody can ban you from the protocol. A relay can refuse your events, but you just connect to a different relay.

The trade-off: no central server also means no push notifications, no guaranteed delivery, and no message history sync across devices (unless you build it yourself).

---

## NIPs Used by Alina

Alina implements a specific subset of NIPs. Here's what each one does and how Alina uses it.

### NIP-01 — Basic Protocol

The foundation. Defines the event structure, how clients talk to relays (REQ, EVENT, CLOSE messages over WebSocket), and how subscriptions work.

Alina's `nostr.ts` implements this directly: `connectRelay()` opens a WebSocket, `subscribeAll()` sends REQ filters, `publishToRelays()` sends EVENT messages.

### NIP-04 — Encrypted Direct Messages (Legacy)

Used for 1:1 DMs in Alina. The encryption works like this:

1. Both parties derive a shared secret using ECDH (Elliptic Curve Diffie-Hellman) from their key pairs
2. The message is AES-256-CBC encrypted with this shared secret
3. The ciphertext + IV are published as a Kind 4 event, tagged with the recipient's pubkey

```
Sender privkey + Recipient pubkey → shared secret → AES-256-CBC encrypt → Kind 4 event
```

**Known weaknesses of NIP-04:** The sender and recipient pubkeys are visible in plaintext on the event. Anyone watching the relay can see who's talking to whom — just not what they're saying. There's also no authentication of the ciphertext (no HMAC), which makes it vulnerable to certain attacks. NIP-04 is considered deprecated in the broader Nostr ecosystem, but it's simple and widely supported.

In Alina: `crypto.ts` → `encryptDM()` / `decryptDM()` use `nip04.encrypt` / `nip04.decrypt` from nostr-tools.

### NIP-17 — Private Direct Messages (Gift Wrap)

Used for group messages in Alina. This is the modern replacement for NIP-04 with much better metadata protection. It uses three layers:

**Layer 1 — Rumor (Kind 14):**
The actual chat message. It's a regular Nostr event but **unsigned** — it has no `id` or `sig`. This is intentional: the rumor never appears on a relay by itself, so it doesn't need a signature. It contains the message text and a tag pointing to the room hash.

**Layer 2 — Seal (Kind 13):**
The rumor gets encrypted with **NIP-44** (see below) for a specific recipient and wrapped in a Kind 13 event. This event IS signed by the real sender. But it has no tags — no `p` tag, no room reference. From the outside, it's just an encrypted blob signed by someone.

**Layer 3 — Gift Wrap (Kind 1059):**
The seal gets encrypted AGAIN, this time with an **ephemeral private key** that's generated fresh for each message. The Gift Wrap is signed by this throwaway key, not by the real sender. The only tag is `p` pointing to the recipient — so the relay knows where to deliver it, but can't tell who sent it.

```
Message → Rumor (unsigned) → Seal (encrypted for recipient, signed by sender)
→ Gift Wrap (encrypted with ephemeral key, tagged to recipient)
```

**What this achieves:** A relay sees a Gift Wrap from a random ephemeral pubkey, addressed to a recipient. It can't see the real sender. It can't see the message content. It can't even link two Gift Wraps from the same sender because each uses a different ephemeral key.

**Timestamp jitter:** Alina randomizes the `created_at` field by ±24 hours on Seals and Gift Wraps. This prevents timing analysis (correlating when messages were sent to figure out who's talking).

In Alina: `crypto.ts` → `createSeal()`, `createGiftWrap()`, `unwrapGiftWrap()`, `unsealRumor()`.

### NIP-44 — Versioned Encryption

The encryption algorithm used inside NIP-17. It's a significant upgrade over NIP-04's AES-256-CBC:

- Uses **XChaCha20-Poly1305** (authenticated encryption — tampering is detected)
- Adds **message padding** (hides the exact message length)
- Has proper **versioning** so the algorithm can be upgraded in the future
- Key derivation uses **HKDF** instead of raw ECDH

In Alina: `crypto.ts` → `nip44Encrypt()` / `nip44Decrypt()` use `nip44.v2.encrypt` / `nip44.v2.decrypt` from nostr-tools.

### NIP-19 — Bech32 Entity Encoding

Defines human-readable encodings for keys and other identifiers:

- `nsec1...` → private key
- `npub1...` → public key
- `note1...` → event ID
- `nprofile1...`, `nevent1...` → compound references (not used by Alina)

Alina uses this for key import/export: `encodeNsec()`, `decodeNsec()`, `encodeNpub()`, `decodeNpub()` in `crypto.ts`.

### Custom: Kind 10420 — Invite Code

This is **not a standard NIP** — it's a custom event kind invented for Alina. It works like this:

1. User generates a random 6-digit code
2. The code is hashed with SHA-256 (prefixed with `alina-invite-v1:`)
3. A Kind 10420 event is published with the hash as a `t` tag and an expiration timestamp
4. The event content contains the user's display name (JSON)

When someone enters the code, Alina hashes it the same way and searches relays for a matching `t` tag. If found, both users now know each other's public key. The actual code never appears on any relay — only its hash.

### Custom: Kind 42 — Room Presence

Also Alina-specific. A simple signed event that says "this pubkey is active in this room." It's tagged with the room's hash (an `e` tag). The content contains the sender's display name.

This is **not encrypted** — it's a public announcement. It has to be, because new room members need to discover existing members before they can send encrypted Gift Wraps to them.

---

## Nostr Protocol Usage in Alina

Now that the protocol concepts are clear, here's how Alina actually uses them.

### Identity

A user's identity is a **secp256k1 key pair**. The private key stays in the browser's localStorage. There is no server-side account.

- Private key → stored locally, never transmitted
- Public key → shared with contacts (called "sharing code" in the UI)
- Display name → stored locally + sent inside encrypted message payloads

### Direct Messages (NIP-04)

1:1 messages use **NIP-04** encryption:
1. Sender encrypts message with `nip04.encrypt(senderPrivkey, recipientPubkey, plaintext)`
2. Encrypted content is published as a **Kind 4** event to all connected relays
3. Recipient decrypts with `nip04.decrypt(recipientPrivkey, senderPubkey, ciphertext)`

### Group Messages (NIP-17 Gift Wrap)

Group chats use the **NIP-17** triple-layer encryption as described above. For each message in a group, Alina creates one Gift Wrap per member. This is heavier than NIP-04 but hides who's talking to whom.

### Room Discovery

Rooms are identified by a SHA-256 hash of the room name (prefixed with `alina-room-v1:`). Members discover each other through **Kind 42 presence events** — non-sensitive public announcements that say "I'm in this room."

### Invite Codes

Contacts find each other via 6-digit invite codes:
1. User A generates a code → publishes a **Kind 10420** event with the code's SHA-256 hash
2. User B enters the code → Alina hashes it, searches relays for a matching event
3. If found → both users now have each other's public key and can message directly

Codes expire after 10 minutes (`INVITE_CODE_DURATION = 600`).

### Connected Relays

```
wss://relay.damus.io
wss://nos.lol
wss://nostr.mom
wss://nostr.wine
wss://purplepag.es
wss://relay.primal.net
wss://relay.nostr.bg
```

Relay connections use exponential backoff (5s base, 120s max) on disconnect.

### Message Flow — Complete Example

Here's what happens when User A sends a DM to User B:

```
1. User A types "Hey!" and hits send
2. Alina JSON-encodes: {"type":"text","content":"Hey!"}
3. nip04.encrypt(A.privkey, B.pubkey, json) → ciphertext
4. createSignedEvent({kind:4, content:ciphertext, tags:[["p", B.pubkey]]}, A.privkey)
5. publishToRelays(event) → sent to all 7 relays via WebSocket
6. User B's client has a subscription: {kinds:[4], #p:[B.pubkey]}
7. Relay matches and delivers the event to User B
8. nip04.decrypt(B.privkey, A.pubkey, ciphertext) → "Hey!"
```

And for a group message from User A in a room with B and C:

```
1. User A types "Hello group" and hits send
2. Alina JSON-encodes: {"type":"text","content":"Hello group","name":"Alice"}
3. Creates Rumor (Kind 14): unsigned, tagged with room hash
4. For User B:
   a. createSeal(A.privkey, A.pubkey, B.pubkey, rumor) → Kind 13, NIP-44 encrypted
   b. createGiftWrap(B.pubkey, seal) → Kind 1059, ephemeral key, tagged to B
   c. publishToRelays(giftWrap)
5. For User C:
   a. createSeal(A.privkey, A.pubkey, C.pubkey, rumor) → Kind 13, NIP-44 encrypted
   b. createGiftWrap(C.pubkey, seal) → Kind 1059, different ephemeral key, tagged to C
   c. publishToRelays(giftWrap)
6. Relay delivers each Gift Wrap to the respective recipient
7. Recipient unwraps: giftWrap → seal → rumor → message
```

### Nostr vs. Alina: What's Standard, What's Custom

| Feature | Standard NIP | Alina-specific |
|---------|-------------|----------------|
| Key pairs (secp256k1) | NIP-01 | — |
| Event signing (Schnorr) | NIP-01 | — |
| Relay WebSocket protocol | NIP-01 | — |
| Direct messages | NIP-04 | — |
| Gift Wrap (group encryption) | NIP-17 | — |
| NIP-44 encryption | NIP-44 | — |
| Key encoding (nsec/npub) | NIP-19 | — |
| Invite codes (Kind 10420) | — | Custom kind |
| Room presence (Kind 42) | — | Custom usage* |
| Room hashing scheme | — | Custom (`alina-room-v1:` prefix) |
| Timestamp jitter (±24h) | — | Custom privacy measure |

*Kind 42 is defined in NIP-28 for public chat channels, but Alina uses it differently — as a presence/discovery mechanism for private rooms.

---

## Data Storage

Everything lives in **localStorage**. There is no database, no cloud sync.

| Key | Content |
|-----|---------|
| `alina_identity` | Private key (as byte array), public key, display name |
| `alina_contacts` | Map of pubkey → {pubkey, name} |
| `alina_rooms` | Map of roomHash → {name, hash, members[]} |
| `alina_messages` | Map of chatId → Message[] (max 200 per chat) |
| `alina_unread` | Map of chatId → unread count |
| `alina_logs` | Debug log entries (max 100) |
| `alina_offline_queue` | Messages queued while offline |
| `alina-lang` | UI language ("en" or "ru") |
| `alina-autotranslate` | Auto-translate toggle |
| `alina-allow-external-translate` | Allow MyMemory API fallback |

**Quota handling:** All writes go through `safeSave()` which catches `QuotaExceededError` and logs it instead of crashing.

**Important:** If the user clears browser data or loses access to the device, everything is gone. There is no recovery mechanism except re-importing the private key (if they saved it).

---

## Features

### Disappearing Messages
Messages can have a TTL (time-to-live). The `useEphemeralCleanup` hook runs every 5 seconds and removes expired messages from state and localStorage.

### Auto-Translation
Two-tier translation:
1. **Chrome AI Translator** (offline, private) — used first if available (Chrome 127+)
2. **MyMemory API** (external, free) — fallback, only if user explicitly enables it

Results are cached in localStorage with a djb2 hash key.

### Offline Queue
If the device goes offline, outgoing messages are queued in localStorage. When `navigator.onLine` fires, the queue is flushed automatically.

### PWA
Alina is installable as a Progressive Web App. Workbox handles caching of all assets and Google Fonts. The app works offline for reading existing messages; sending requires a relay connection.

### Image Sharing
Images are sent as base64-encoded strings inside the encrypted message payload. Max size: 500 KB.

### Location Sharing
Users can share their GPS coordinates. Displayed as a what3words-style code with a link to OpenStreetMap.

---

## Internationalization

Two languages: **English** and **Russian**. All UI strings live in `src/lib/i18n.ts`. The language toggle is a switch component available on the landing page, setup screen, and settings modal.

No German. The app's audience includes Russian-speaking family members, so Russian is a first-class language, not an afterthought.

---

## Styling

Single CSS file: `src/styles/index.css` (~1900 lines).

### Design Tokens

**App (dark theme):**
- Background: `#0e0e0f`
- Surface: `#18181b`
- Accent (gold): `#c8a97e`
- Accent 2 (green): `#8fa68e`
- Text: `#ede8df`

**Landing page (light theme):**
- Sand: `#fdfaf7`
- Warm: `#B38463`
- Ink: `#1c1713`

### Fonts
- **Jost** (sans-serif) — body text, brand name
- **Playfair Display** (serif) — headlines on landing page
- **DM Sans** — app UI body text
- **DM Serif Display** — app UI display text

### UI Components from Uiverse.io
Several UI elements use adapted CSS animations from Uiverse.io:
- **Button hover:** `translateY(-0.335rem)` + box-shadow lift (all buttons)
- **Language toggle:** Switch slider (EN/RU)
- **Checkboxes:** Cyberpunk-style fill animation (`.alina-checkbox`)
- **Input fields:** Wave-label animation (`.wave-group`)
- **Splash loader:** Bubble animation (two-circle bounce)
- **Social icons:** Tooltip hover in footer

---

## Build & Deploy

### Local Development
```bash
cd "Alina Chat/Alina"
npm install
npm run dev          # → http://localhost:5173
```

### Production Build
```bash
npm run build        # tsc + vite build → dist/
```

### Deploy to Vercel
```bash
npx vercel --prod --yes
```

Deployed to: https://alina-chat-tau.vercel.app
Vercel project: `wearesmg/alina-chat`

---

## Testing

```bash
npx vitest           # run unit tests
```

Tests cover:
- `crypto.test.ts` — key generation, encryption/decryption
- `storage.test.ts` — localStorage persistence
- `store.test.ts` — Zustand store actions

Test environment: jsdom (via Vitest).

---

## Security Model

### What's protected
- Message contents — encrypted end-to-end (NIP-04 for DMs, NIP-17 for groups)
- Sender-recipient relationship in groups — hidden by ephemeral keys (Gift Wrap)
- Invite codes — only the hash is published, not the code itself
- Timestamps in group messages — randomized ±24h to hide metadata

### What's NOT protected
- **Relay operators** can see who connects (IP addresses) and message metadata (timestamps, public keys for DMs)
- **localStorage** is not encrypted — anyone with access to the device can read everything
- **NIP-04** (used for DMs) is considered legacy and has known weaknesses. NIP-17 is better but only used for group chats currently
- **No forward secrecy** — if a private key is compromised, all past messages can be decrypted
- **No key rotation** — the same key pair is used indefinitely

### Recommendations for future work
- Migrate DMs from NIP-04 to NIP-17
- Add encrypted localStorage (e.g., Web Crypto API with a user passphrase)
- Implement key rotation
- Add relay connection through Tor for IP privacy

---

## Known Limitations

- **200 messages per chat** — older messages are dropped (configurable in `constants.ts`)
- **500 KB image limit** — images are base64-encoded inside messages, which is inefficient
- **localStorage only** — no IndexedDB, no sync, data lost on browser clear
- **No push notifications** — PWA limitation without a push server
- **No read receipts** — by design (privacy)
- **No typing indicators** — by design (privacy)
- **Group messages scale linearly** — one Gift Wrap per member per message

---

## Environment & Deployment Info

| Item | Value |
|------|-------|
| Node.js | 18+ required |
| Vercel project | `wearesmg/alina-chat` |
| Domain | `alina-chat-tau.vercel.app` |
| Supabase project | `rewatergap` (currently paused/inactive) |
| PWA manifest | `vite.config.ts` → VitePWA plugin |

---

*Last updated: April 2026*