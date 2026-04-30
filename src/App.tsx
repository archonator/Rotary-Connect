import { useEffect, useState, useCallback } from 'react'
import { useStore } from './store/useStore'
import { useNostrRelays } from './hooks/useNostrRelays'
import { useEphemeralCleanup } from './hooks/useEphemeralCleanup'
import { SetupScreen } from './components/setup/SetupScreen'
import { Sidebar } from './components/sidebar/Sidebar'
import { ChatArea } from './components/chat/ChatArea'
import { AddContactModal } from './components/modals/AddContactModal'
import { AddRoomModal } from './components/modals/AddRoomModal'
import { SettingsModal } from './components/modals/SettingsModal'
import { KeyMigrationModal } from './components/modals/KeyMigrationModal'
import { StatusBar } from './components/ui/StatusBar'
import { AppSplash } from './components/ui/AppSplash'
import { PwaBanner } from './components/ui/PwaBanner'
import { PinLock, PinSetup, getVaultGateMode } from './components/ui/PinLock'

/**
 * Die fünf Phasen, die App.tsx vom Start bis zum Ready-Zustand durchläuft.
 *
 *   splash             — Initialer Splashscreen, ~2.8 s
 *   vault-unlock       — Vorhandener Vault, User muss PIN eingeben
 *   vault-setup        — Klartext-Daten vorhanden (Pre-Vault-User), PIN setzen + migrieren
 *   setup              — Frische Installation, Identität anlegen oder importieren
 *   pin-after-setup    — Direkt nach setup einen PIN setzen, damit die frische Identität
 *                        auch verschlüsselt persistiert wird
 *   ready              — Hauptoberfläche (Sidebar + Chat)
 *
 * In welche Phase wir nach dem Splash gehen, entscheidet
 * `getVaultGateMode()` in `PinLock.tsx`.
 */
type AppPhase = 'splash' | 'vault-unlock' | 'vault-setup' | 'setup' | 'pin-after-setup' | 'ready'

/**
 * Wurzelkomponente der Messenger-App.
 *
 * Verantwortlich für:
 *   • Phasen-Routing (Splash → Vault-Setup/Unlock → Identitäts-Setup → Ready)
 *   • Mounten der globalen Hooks (Relays + WebRTC, Ephemeral-Cleanup)
 *   • Auswahl, welche Modale gerade offen sind
 *
 * Die einzelnen UI-Bausteine (Sidebar, ChatArea, Modale) leben in
 * eigenen Komponenten unter src/components/.
 */
export function App() {
  const identity = useStore(s => s.identity)
  const hydrate = useStore(s => s.hydrate)
  const openModal = useStore(s => s.openModal)
  const [phase, setPhase] = useState<AppPhase>('splash')

  // Diese Hooks sind nur in der "ready"-Phase nötig, aber React darf
  // Hooks nicht conditional aufrufen — also einfach immer mounten.
  // Die Hooks selbst checken intern, ob `identity` gesetzt ist.
  useNostrRelays()
  useEphemeralCleanup()

  // Markenfarbe in den (Custom-Element-)PWA-Install-Dialog reichen.
  useEffect(() => {
    const el = document.querySelector('pwa-install') as any
    if (el) el.styles = { '--tint-color': '#F7A81B' }
  }, [])

  const onSplashDone = useCallback(() => {
    const mode = getVaultGateMode()
    if (mode === 'unlock') {
      setPhase('vault-unlock')
    } else if (mode === 'setup') {
      setPhase('vault-setup') // existing plaintext data needs migration
    } else {
      setPhase('setup') // no data at all — new user
    }
  }, [])

  // ── Splash screen ──────────────────────────────────────────────
  if (phase === 'splash') {
    return <AppSplash onDone={onSplashDone} />
  }

  // ── Vault unlock (existing encrypted data) ─────────────────────
  if (phase === 'vault-unlock') {
    return (
      <PinLock
        onUnlock={() => {
          hydrate()
          setPhase('ready')
        }}
      />
    )
  }

  // ── Vault setup / migration (existing plaintext data) ──────────
  if (phase === 'vault-setup') {
    return (
      <PinSetup
        isMigration={true}
        onComplete={() => {
          hydrate()
          setPhase('ready')
        }}
      />
    )
  }

  // ── New user setup ─────────────────────────────────────────────
  if (phase === 'setup') {
    if (!identity) {
      return (
        <SetupScreen
          onIdentityCreated={() => {
            // Identity saved to localStorage (plaintext temporarily)
            // Now require PIN setup to encrypt it
            setPhase('pin-after-setup')
          }}
        />
      )
    }
    // Identity exists but somehow phase is still 'setup' — go to ready
    setPhase('ready')
    return null
  }

  // ── PIN setup right after creating/importing identity ──────────
  if (phase === 'pin-after-setup') {
    return (
      <PinSetup
        isMigration={true}
        onComplete={() => {
          hydrate()
          setPhase('ready')
        }}
      />
    )
  }

  // ── Main app ───────────────────────────────────────────────────
  if (!identity) {
    // Edge case: vault unlocked but no identity (shouldn't happen normally)
    return (
      <SetupScreen
        onIdentityCreated={() => setPhase('pin-after-setup')}
      />
    )
  }

  return (
    <div id="screen-app" className="screen active">
      <Sidebar />
      <ChatArea />

      {openModal === 'add-contact' && <AddContactModal />}
      {openModal === 'add-room' && <AddRoomModal />}
      {openModal === 'settings' && <SettingsModal />}
      {openModal === 'key-migration' && <KeyMigrationModal />}

      <StatusBar />
      <PwaBanner />
    </div>
  )
}
