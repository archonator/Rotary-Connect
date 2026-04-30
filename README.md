# Rotary Connect

**Connecting Rotarians worldwide. Private. Decentralized. No server.**

Rotary Connect is an end-to-end encrypted messenger with no account, no server, and no tracking — built on the open [Nostr](https://nostr.com) protocol and designed for the Rotary community.

---

## Highlights

- **No account** — no username, no phone number, no email
- **No server** — messages travel through decentralized Nostr relays
- **End-to-end encrypted** — DMs use NIP-04, group rooms use NIP-17 (Sealed + Gift Wrapped)
- **Optional WebRTC P2P** — direct peer-to-peer when both sides are online (relays as fallback)
- **Local vault** — all device data is encrypted at rest with a user PIN (PBKDF2 + AES-256-GCM, non-extractable key)
- **Invite-based** — add contacts via 6-digit one-time codes (or `npub`)
- **Group rooms** — anyone with the same room name joins the same chat
- **Disappearing messages** — per-message TTL from 30 seconds to 24 hours
- **Key rotation** — rotate your Nostr identity with cross-signed migration events
- **Offline queue** — compose offline, automatic flush on reconnect
- **Auto-translation** — client-side translation via Chrome AI (offline) with optional MyMemory fallback
- **PWA** — installable on iOS, Android, and desktop

---

## Tech stack

| Layer | Technology |
|---|---|
| UI | React 19 + TypeScript |
| Routing | react-router-dom 7 (`/` landing, `/app` messenger) |
| State | Zustand 5 |
| Protocol | Nostr (NIP-01, NIP-04, NIP-17, NIP-19, custom kinds 10420 / 10051 / 25050) |
| Crypto | nostr-tools 2 + WebCrypto (AES-GCM, PBKDF2) |
| P2P | WebRTC (RTCPeerConnection + RTCDataChannel) with Nostr signaling |
| Translation | Chrome AI Translation API + MyMemory fallback |
| Build | Vite 6 + vite-plugin-pwa (Workbox) |
| Icons | Lucide React |
| Deployment | Vercel (static SPA) |

---

## Local development

```bash
git clone https://github.com/archonator/Rotary-Connect.git
cd Rotary-Connect
npm install
npm run dev
```

App runs on `http://localhost:5173`.

```bash
npm test          # run unit tests (vitest)
npm run build     # type-check + production bundle to dist/
npm run preview   # serve dist/ locally
```

---

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design, crypto layers, message flow
- [FEATURES.md](./FEATURES.md) — feature list with technical notes
- [ROADMAP.md](./ROADMAP.md) — what's next

---

## License

MIT © 2026 Kay (__archon) Muehlenbruch
