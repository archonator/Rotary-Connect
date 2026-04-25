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
import { isVaultActive } from './lib/vault'
import { hasPlaintextData } from './lib/storage'

type AppPhase = 'splash' | 'vault-unlock' | 'vault-setup' | 'setup' | 'pin-after-setup' | 'ready'

export function App() {
  const identity = useStore(s => s.identity)
  const hydrate = useStore(s => s.hydrate)
  const openModal = useStore(s => s.openModal)
  const setOpenModal = useStore(s => s.setOpenModal)
  const [phase, setPhase] = useState<AppPhase>('splash')

  useNostrRelays()
  useEphemeralCleanup()

  // Apply brand colour to pwa-install dialog
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
