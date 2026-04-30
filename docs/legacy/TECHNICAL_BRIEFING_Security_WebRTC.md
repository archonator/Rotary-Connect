# Technisches Briefing: Sicherheit & WebRTC Mesh

**Projekt:** Alina Chat v3.0.0
**Datum:** 12. April 2026
**Autor:** Technische Analyse auf Basis der Codebase
**Anlass:** Feedback von Badr — zwei strategische Verbesserungsvorschläge

---

## Teil 1: Key Rotation & localStorage-Verschlüsselung

### 1.1 Ist-Zustand — Was liegt offen?

Der gesamte App-State wird **unverschlüsselt** in `localStorage` gespeichert. Konkret betroffen:

| Schlüssel | Inhalt | Risiko |
|---|---|---|
| `alina_identity` | Private Key als JSON-Array, Public Key, Name | **KRITISCH** |
| `alina_messages` | Alle entschlüsselten Nachrichten (bis 200 pro Chat) | **KRITISCH** |
| `alina_offline_queue` | Nachrichtenwarteschlange mit Klartext-Payloads | **KRITISCH** |
| `alina-pin-hash` | PBKDF2-Hash des PINs | **HOCH** |
| `alina-pin-salt` | Salt für PIN-Ableitung | **HOCH** |
| `alina_contacts` | Kontakt-Pubkeys + Namen | Mittel |
| `alina_rooms` | Raum-Hashes, Namen, Mitglieder-Pubkeys | Mittel |

**Zentrales Problem:** Jedes JavaScript, das auf derselben Origin ausgeführt wird (XSS, Browser-Extension, kompromittierte Dependency), kann mit einem einzigen Aufruf den Private Key auslesen:

```javascript
JSON.parse(localStorage.getItem('alina_identity')).privkey
```

Damit ist die gesamte Kommunikation kompromittiert — vergangene, gegenwärtige und zukünftige.

### 1.2 Angriffsszenarien

1. **XSS-Angriff:** Ein eingeschleustes Script liest `alina_identity` aus und exfiltriert den Key.
2. **Malicious Browser Extension:** Extensions mit `storage`-Berechtigung haben vollen Zugriff auf localStorage.
3. **Physischer Zugriff:** Wer den Browser öffnet, kann über DevTools sofort alle Keys und Nachrichten sehen.
4. **Supply-Chain-Angriff:** Eine kompromittierte npm-Dependency hat zur Laufzeit Zugriff auf `window.localStorage`.

### 1.3 Lösung: Verschlüsselung at Rest

#### Stufe 1 — AES-GCM-Verschlüsselung mit PIN-abgeleitetem Schlüssel (Empfohlen als Sofortmaßnahme)

**Konzept:** Der bestehende PIN (aktuell nur UI-Lock) wird zum Ableitungsschlüssel für die localStorage-Verschlüsselung.

```
PIN → PBKDF2 (600.000 Iterationen, 256-bit Salt) → AES-256-GCM Master Key
Master Key + Random IV → Verschlüsselter localStorage-Blob
```

**Implementierungsplan:**

```
src/lib/
├── vault.ts          ← NEU: Verschlüsselungsschicht
├── storage.ts        ← ANPASSEN: Liest/schreibt über vault.ts
└── crypto.ts         ← ERWEITERN: PBKDF2-Ableitung
```

**vault.ts — Kernlogik:**

```typescript
// Pseudocode
interface Vault {
  unlock(pin: string): Promise<void>       // Leitet Master Key ab
  encrypt(data: string): Promise<string>   // AES-256-GCM
  decrypt(cipher: string): Promise<string> // AES-256-GCM
  lock(): void                             // Löscht Key aus Memory
  isUnlocked(): boolean
}

// Ablauf:
// 1. App-Start → PIN-Eingabe → PBKDF2 → Master Key im Memory
// 2. Jeder localStorage-Zugriff geht über vault.encrypt/decrypt
// 3. App in Background → Auto-Lock nach Timeout → Key aus Memory löschen
```

**Änderungen an bestehenden Dateien:**

- **`storage.ts`**: Alle `safeSave()` und `load*()` Funktionen erhalten Vault-Integration
- **`PinLock.tsx`**: PIN wird Pflicht (nicht optional), Unlock-Flow initialisiert Vault
- **`useStore.ts`**: State-Initialisierung wartet auf Vault-Unlock
- **`offlineQueue.ts`**: Queue-Einträge werden verschlüsselt gespeichert

**Geschätzter Aufwand:** 3–5 Tage

#### Stufe 2 — Web Crypto API mit nicht-exportierbarem CryptoKey

**Konzept:** Statt den Master Key als JavaScript-Variable zu halten, wird er als `CryptoKey` mit `extractable: false` in der Web Crypto API erzeugt. JavaScript-Code kann den Key **nutzen**, aber nicht **auslesen**.

```typescript
const masterKey = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
  pinKeyMaterial,
  { name: 'AES-GCM', length: 256 },
  false,  // ← extractable: false — Key kann nicht ausgelesen werden
  ['encrypt', 'decrypt']
)
```

**Vorteil:** Selbst bei XSS kann der Angreifer den Master Key nicht exfiltrieren — er kann nur im aktuellen Browser-Kontext damit verschlüsseln/entschlüsseln.

**Geschätzter Aufwand:** +1 Tag (aufbauend auf Stufe 1)

#### Stufe 3 — IndexedDB als Alternative zu localStorage

**Warum:** localStorage hat ein Limit von ~5–10 MB. Bei wachsendem Nachrichtenvolumen wird das eng. IndexedDB bietet strukturierte Speicherung und mehr Kapazität.

**Geschätzter Aufwand:** +2–3 Tage (optionaler Umbau, nicht dringend)

### 1.4 Key Rotation

**Problem:** Aktuell wird der Nostr-Schlüssel einmal generiert und nie gewechselt. Bei Kompromittierung gibt es keinen Recovery-Mechanismus.

**Herausforderung bei Nostr:** Nostr-Identitäten *sind* ihre Schlüssel. Ein Schlüsselwechsel bedeutet eine neue Identität. Das Protokoll hat dafür keinen eingebauten Mechanismus.

**Pragmatischer Ansatz — „Key Migration":**

```
Alter Key → Signiert „Migration Event" (NIP-Vorschlag) → Neuer Key
Kontakte erhalten: „Alice hat einen neuen Schlüssel. Verifiziere über QR-Code."
```

**Implementierungsschritte:**

1. **Migration-Event erstellen** (Kind 10050 oder custom)
   - Vom alten Key signiert
   - Enthält neuen Public Key
   - Enthält Beweis der Kontrolle über neuen Key (Cross-Signatur)

2. **Automatische Benachrichtigung**
   - Alle Kontakte erhalten eine verschlüsselte DM mit dem neuen Key
   - UI zeigt Warnung: „Alice hat den Schlüssel gewechselt"

3. **Verifikation**
   - QR-Code-Scan oder manueller Fingerprint-Vergleich
   - Trust-on-First-Use (TOFU) mit expliziter Bestätigung

4. **Kontakt-Update**
   - Nach Bestätigung: Alter Key → Neuer Key in Kontaktliste
   - Alte Nachrichten bleiben mit altem Key verknüpft

**Einschränkungen:**
- Nachrichtenhistorie kann nicht mit neuem Key re-encrypted werden (Nostr-Limitation)
- Beide Seiten müssen die Migration unterstützen
- Gruppenräume erfordern Re-Join mit neuem Key

**Geschätzter Aufwand:** 5–8 Tage

---

## Teil 2: WebRTC Mesh — Peer-to-Peer-Kommunikation

### 2.1 Vision

Statt alle Nachrichten über zentrale Nostr-Relays zu leiten, kommunizieren Alina-Clients direkt miteinander über WebRTC Data Channels. Das macht die App:

- **Zensurresistent** — kein zentraler Punkt, der blockiert werden kann
- **Latenzarm** — direkte Verbindung statt Umweg über Relay
- **Unabhängig** — funktioniert auch wenn alle Relays offline sind
- **Privat** — Metadaten sind nur den Peers bekannt

### 2.2 Architektur-Vorschlag: Hybrid-Modell

**Reines WebRTC-Mesh hat Probleme:**
- Benötigt Signaling-Server für den Verbindungsaufbau
- NAT-Traversal (STUN/TURN) ist nicht immer zuverlässig
- Offline-Nachrichten gehen verloren (kein Store-and-Forward)

**Lösung: Nostr als Signaling + Fallback, WebRTC als Primärkanal**

```
┌─────────────────────────────────────────────────┐
│                  Alina Client A                  │
│                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │  Nostr    │    │  WebRTC  │    │  Message  │  │
│  │  Layer    │◄──►│  Layer   │◄──►│  Router   │  │
│  │ (Relay)   │    │ (P2P)    │    │           │  │
│  └─────┬────┘    └─────┬────┘    └──────┬────┘  │
│        │               │               │        │
└────────┼───────────────┼───────────────┼────────┘
         │               │               │
    Signaling &     Direct Data      App Logic
    Fallback        Channel          (Store, UI)
         │               │
         ▼               ▼
┌─────────────┐   ┌─────────────┐
│ Nostr Relay │   │  STUN/TURN  │
│  (bestehend)│   │   Server    │
└─────────────┘   └─────────────┘
```

### 2.3 Verbindungsaufbau — Schritt für Schritt

```
Alice                    Nostr Relay                    Bob
  │                          │                           │
  │  1. SDP Offer            │                           │
  │  (NIP-04 encrypted)      │                           │
  │─────────────────────────►│                           │
  │                          │  2. Forward to Bob        │
  │                          │──────────────────────────►│
  │                          │                           │
  │                          │  3. SDP Answer            │
  │                          │  (NIP-04 encrypted)       │
  │                          │◄──────────────────────────│
  │  4. ICE Candidates       │                           │
  │◄─────────────────────────│                           │
  │                          │                           │
  │  5. WebRTC Data Channel established                  │
  │◄════════════════════════════════════════════════════►│
  │                          │                           │
  │  6. Direct E2E messages (no relay needed)            │
  │◄════════════════════════════════════════════════════►│
```

**Signaling über Nostr:** SDP-Offers und ICE-Candidates werden als NIP-04-verschlüsselte Ephemeral Events über bestehende Relays ausgetauscht. Kein separater Signaling-Server nötig.

### 2.4 Implementierungsplan

#### Phase 1 — WebRTC-Grundgerüst (2–3 Wochen)

**Neue Dateien:**

```
src/lib/
├── webrtc/
│   ├── PeerManager.ts       ← Verwaltet alle Peer-Verbindungen
│   ├── SignalingChannel.ts   ← Nostr-basiertes Signaling
│   ├── DataChannel.ts       ← Wrapper um RTCDataChannel
│   └── IceConfig.ts         ← STUN/TURN-Konfiguration
```

**PeerManager.ts — Kernkonzept:**

```typescript
interface PeerManager {
  // Verbindung zu einem Kontakt aufbauen
  connect(pubkey: string): Promise<DataChannel>
  
  // Eingehende Verbindungen akzeptieren
  onIncomingConnection(handler: (pubkey: string, channel: DataChannel) => void): void
  
  // Status einer Verbindung
  getConnectionState(pubkey: string): 'disconnected' | 'connecting' | 'connected'
  
  // Nachricht senden (wählt automatisch WebRTC oder Nostr-Fallback)
  send(pubkey: string, message: EncryptedPayload): Promise<void>
}
```

**Änderungen an bestehenden Dateien:**

- **`nostr.ts`**: Neue Event-Kinds für Signaling (SDP Offer/Answer, ICE Candidates)
- **`useNostrRelays.ts`**: Integration des PeerManagers in den Relay-Hook
- **`useStore.ts`**: Neuer State für Peer-Verbindungen (`peerStatus: Record<string, ConnectionState>`)
- **UI**: Verbindungsstatus-Indikator pro Kontakt (P2P vs. Relay)

#### Phase 2 — Mesh-Netzwerk für Gruppenräume (2–3 Wochen)

**Problem:** In einer Gruppe mit N Mitgliedern braucht Full Mesh N×(N-1)/2 Verbindungen.

**Lösung: Gossip-Protokoll**

```
Bei 5 Mitgliedern:
- Full Mesh: 10 Verbindungen (jeder mit jedem)
- Gossip: 4–6 Verbindungen (jeder mit 2–3 Peers, Weiterleitung)
```

```typescript
// Nachricht an Gruppe senden
async function sendToRoom(roomHash: string, message: Message): void {
  const peers = meshTopology.getConnectedPeers(roomHash)
  
  for (const peer of peers) {
    await peer.send({
      ...message,
      hopCount: 0,
      maxHops: 3,  // Begrenzung gegen Loops
    })
  }
}

// Eingehende Nachrichten weiterleiten
function onGroupMessage(msg: MeshMessage): void {
  if (msg.hopCount < msg.maxHops && !seenMessages.has(msg.id)) {
    seenMessages.add(msg.id)
    // An andere verbundene Peers weiterleiten
    forwardToMeshPeers(msg)
  }
}
```

#### Phase 3 — Resilience & Optimierung (1–2 Wochen)

- **Automatischer Fallback:** WebRTC → Nostr-Relay wenn P2P fehlschlägt
- **NAT-Traversal-Optimierung:** TURN-Server-Fallback für restriktive Netzwerke
- **Bandbreiten-Management:** Quality of Service für Bilder vs. Text
- **Offline-Puffer:** Nachrichten für offline Peers werden über Nostr-Relay zugestellt

### 2.5 STUN/TURN-Infrastruktur

**STUN (kostenlos):**
- Google: `stun:stun.l.google.com:19302`
- Mozilla: `stun:stun.services.mozilla.com`

**TURN (benötigt eigenen Server für zuverlässiges NAT-Traversal):**

Optionen:
1. **Coturn (Self-Hosted):** Open-Source, ~5€/Monat auf einem kleinen VPS
2. **Cloudflare Calls:** Kostenlose TURN-Infrastruktur (Beta)
3. **Metered.ca:** Free Tier mit 500 GB/Monat

**Empfehlung:** Start mit kostenlosen STUN-Servern + Cloudflare Calls als TURN. Langfristig eigener Coturn-Server für volle Kontrolle.

### 2.6 Risiken & Trade-offs

| Aspekt | Pro | Contra |
|---|---|---|
| Latenz | Direkte P2P ist schneller | Verbindungsaufbau dauert 1–3 Sekunden |
| Privatsphäre | Keine Metadaten auf Relays | IP-Adressen werden dem Peer offengelegt |
| Zuverlässigkeit | Unabhängig von Relays | WebRTC-Verbindungen können instabil sein |
| Komplexität | Elegante Architektur | Deutlich mehr Code, Edge-Cases, NAT-Probleme |
| Mobile | Funktioniert in PWA | Background-Tabs verlieren WebRTC-Verbindung |
| Offline | — | Kein Store-and-Forward (Relay als Fallback) |

**IP-Leak-Problem:** Bei WebRTC sieht der Peer die IP-Adresse des Gegenübers. Lösung: Optional über TURN-Server routen (verbirgt IP, erhöht Latenz).

---

## Priorisierung & Empfehlung

```
PRIORITÄT 1 (Sofort — Woche 1–2)
│
├── localStorage-Verschlüsselung (Stufe 1 + 2)
│   └── PIN-Pflicht + AES-256-GCM + nicht-exportierbarer CryptoKey
│       Aufwand: ~4–6 Tage
│       Impact: Schließt die kritischste Sicherheitslücke
│
PRIORITÄT 2 (Kurzfristig — Woche 3–5)
│
├── Key Migration
│   └── Migration-Events + Kontakt-Benachrichtigung + Verifikation
│       Aufwand: ~5–8 Tage
│       Impact: Recovery-Mechanismus bei Kompromittierung
│
PRIORITÄT 3 (Mittelfristig — Woche 6–12)
│
├── WebRTC Mesh Phase 1 + 2
│   └── P2P Data Channels + Nostr-Signaling + Gruppen-Mesh
│       Aufwand: ~4–6 Wochen
│       Impact: Zensurresistenz, Unabhängigkeit von Relays
│
PRIORITÄT 4 (Langfristig — Optional)
│
├── IndexedDB-Migration
│   └── Strukturierte Speicherung, mehr Kapazität
│       Aufwand: ~2–3 Tage
│       Impact: Skalierbarkeit
```

---

## Nächste Schritte

1. **Entscheidung:** Soll der PIN für alle Nutzer Pflicht werden, oder bleibt er optional (mit Warnung)?
2. **STUN/TURN:** Cloudflare Calls evaluieren oder direkt eigenen Coturn aufsetzen?
3. **NIP-Kompatibilität:** Key-Migration als Custom-Event oder auf bestehende NIP-Drafts aufbauen?
4. **IP-Privatsphäre:** Standard-Modus für WebRTC — direkt P2P oder immer über TURN?
