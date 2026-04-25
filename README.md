# Alina

**Sicher. Dezentral. Deins.**

Alina ist ein Ende-zu-Ende verschlüsselter Messenger ohne Server, ohne Konto und ohne Werbung — gebaut auf dem offenen [Nostr](https://nostr.com)-Protokoll.

---

## Was macht Alina besonders?

- **Kein Konto nötig** — kein Benutzername, keine Telefonnummer, keine E-Mail
- **Kein Server** — Nachrichten laufen über dezentrale Nostr-Relays
- **Ende-zu-Ende verschlüsselt** — private Chats mit NIP-04 (ECDH + AES-256-CBC)
- **Einladungsbasiert** — Kontakte werden über 6-stellige Einmalcodes hinzugefügt
- **Gruppenräume** — alle mit demselben Gruppenname landen im gleichen Gespräch
- **Automatische Übersetzung** — Nachrichten in Fremdsprachen werden clientseitig übersetzt, ohne dass der Klartext einen fremden Server erreicht
- **Mehrsprachig** — Deutsch, Englisch, Russisch (umschaltbar vor und nach dem Login)
- **PWA** — installierbar auf dem Homescreen wie eine native App

---

## Automatische Übersetzung

Die Übersetzung passiert **nach** dem NIP-04-Decrypt, vollständig im Browser des Empfängers. Der entschlüsselte Text verlässt das Gerät nicht unverschlüsselt in Richtung Relay.

```
Relay (verschlüsselt) → Alina decrypt → Übersetzungs-API → Anzeige
```

**Provider-Kette:**

1. **Chrome AI Translation API** (Chrome 127+) — offline, kein API-Key, kein Netzwerk
2. **MyMemory API** — kostenloser Fallback, kein Key erforderlich
3. **localStorage-Cache** — jede übersetzte Phrase wird gecacht, wiederholte Anzeige kostet keinen API-Call

**Spracherkennung:**

1. Chrome AI Language Detector (falls verfügbar)
2. Script-Heuristik als Fallback (Kyrillisch → ru/uk, CJK → zh/ja, Arabisch → ar …)

Übersetzung ein-/ausschalten: Einstellungen → „Automatisch übersetzen"

---

## Technologie

| Was | Womit |
|---|---|
| Frontend | React 19 + TypeScript |
| State | Zustand |
| Protokoll | Nostr (NIP-01, NIP-04, NIP-19) |
| Übersetzung | Chrome AI API + MyMemory |
| Build | Vite + vite-plugin-pwa |
| Icons | Lucide React |
| Deployment | Vercel |

---

## Lokale Entwicklung

```bash
git clone https://github.com/Leon-Muehlenbruch/Alina
cd Alina
npm install
npm run dev
```

App läuft auf `http://localhost:5173`

---

## Features & Roadmap

Siehe [FEATURES.md](./FEATURES.md)

---

## Lizenz

MIT
