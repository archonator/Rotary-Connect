import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { encodeNpub } from '../../lib/crypto'
import { performKeyMigration } from '../../lib/nostr'
import { ConfirmDialog } from '../ui/ConfirmDialog'

/**
 * KeyMigrationModal — UI-Flow für die Schlüsselrotation.
 *
 * Schritte aus Sicht der Komponente:
 *
 *   confirm   — Bestätigungsdialog mit Warnung. Erst nach explizitem
 *               Klick auf "Rotate Key" geht es weiter.
 *   migrating — Fortschrittsanzeige, während performKeyMigration
 *               läuft (neuen Key erzeugen, Cross-Sig, Migrations-
 *               Event publishen, Kontakte per DM benachrichtigen).
 *   done      — Erfolgsbildschirm mit dem neuen npub und einem
 *               Hinweis, den Fingerprint mit Kontakten zu verifizieren.
 *   error     — Fehlerfall mit Beschreibung.
 *
 * Achtung: Die eigentliche Krypto + Relay-Kommunikation passiert in
 * `lib/nostr.ts → performKeyMigration`. Diese Komponente sorgt nur
 * dafür, dass die Identität anschließend auch lokal aktualisiert ist.
 */
export function KeyMigrationModal() {
  const identity = useStore(s => s.identity)
  const contacts = useStore(s => s.contacts)
  const setOpenModal = useStore(s => s.setOpenModal)
  const showStatus = useStore(s => s.showStatus)

  const [phase, setPhase] = useState<'confirm' | 'migrating' | 'done' | 'error'>('confirm')
  const [newPubkey, setNewPubkey] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  if (!identity) return null

  const close = () => setOpenModal(null)

  const handleMigrate = async () => {
    setPhase('migrating')
    try {
      const newKeyPair = await performKeyMigration(
        identity.privkey,
        identity.pubkey,
        contacts,
        identity.name,
      )

      // Update local identity with new key directly in the store
      const newIdentity = {
        privkey: newKeyPair.privkey,
        pubkey: newKeyPair.pubkey,
        name: identity.name,
      }
      // Save via store mechanisms
      const storage = await import('../../lib/storage')
      storage.saveIdentity(newIdentity)
      useStore.setState({ identity: newIdentity })

      setNewPubkey(encodeNpub(newKeyPair.pubkey))
      setPhase('done')
    } catch (e) {
      setErrorMsg(String(e))
      setPhase('error')
    }
  }

  if (phase === 'confirm') {
    return (
      <ConfirmDialog
        title="Rotate Key"
        message={`This will generate a new Nostr key pair and notify all ${Object.keys(contacts).length} contact(s). Your old key will no longer be used. Messages encrypted with the old key cannot be re-encrypted.\n\nMake sure you have backed up your current private key first.`}
        confirmLabel="Rotate Key"
        cancelLabel="Cancel"
        onConfirm={handleMigrate}
        onCancel={close}
        danger
      />
    )
  }

  return (
    <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && close()}>
      <div className="modal" style={{ textAlign: 'center' }}>
        {phase === 'migrating' && (
          <>
            <div className="modal-title">Rotating Key...</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--muted)', padding: '1rem 0' }}>
              Generating new key pair and notifying contacts...
            </div>
          </>
        )}

        {phase === 'done' && (
          <>
            <div className="modal-title" style={{ color: 'var(--accent)' }}>Key Rotated</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text)', padding: '0.5rem 0', lineHeight: 1.6 }}>
              Your identity has been migrated to a new key. All contacts have been notified.
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
              New public key:
            </div>
            <div
              className="key-display"
              onClick={() => navigator.clipboard.writeText(newPubkey).then(() => showStatus('Copied!', 2000))}
              style={{ fontSize: '0.72rem', cursor: 'pointer', wordBreak: 'break-all' }}
            >
              {newPubkey}
            </div>
            <div style={{
              fontSize: '0.72rem', color: '#c97070', background: 'rgba(201,112,112,0.08)',
              border: '1px solid rgba(201,112,112,0.2)', borderRadius: 8,
              padding: '0.6rem 0.8rem', marginTop: '0.8rem', lineHeight: 1.5,
            }}>
              Contacts should verify your new key via QR code or fingerprint comparison to prevent impersonation.
            </div>
            <div className="modal-actions" style={{ marginTop: '1rem' }}>
              <button className="btn" onClick={close}>Done</button>
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <div className="modal-title" style={{ color: 'var(--danger)' }}>Migration Failed</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--danger)', padding: '1rem 0' }}>
              {errorMsg}
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={close}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
