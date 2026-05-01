import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useT } from '../../hooks/useT'
import { encodeNpub } from '../../lib/crypto'
import { performKeyMigration } from '../../lib/nostr'
import { saveIdentity } from '../../lib/storage'
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
  const t = useT()
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
      saveIdentity(newIdentity)
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
        title={t('migration.confirmTitle')}
        message={t('migration.confirmMessage', { n: String(Object.keys(contacts).length) })}
        confirmLabel={t('migration.confirmBtn')}
        cancelLabel={t('migration.cancel')}
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
            <div className="modal-title">{t('migration.migratingTitle')}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--muted)', padding: '1rem 0' }}>
              {t('migration.migratingDesc')}
            </div>
          </>
        )}

        {phase === 'done' && (
          <>
            <div className="modal-title" style={{ color: 'var(--accent)' }}>{t('migration.doneTitle')}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text)', padding: '0.5rem 0', lineHeight: 1.6 }}>
              {t('migration.doneDesc')}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
              {t('migration.newPubkey')}
            </div>
            <div
              className="key-display"
              onClick={() => navigator.clipboard.writeText(newPubkey).then(() => showStatus(t('migration.copied'), 2000))}
              style={{ fontSize: '0.72rem', cursor: 'pointer', wordBreak: 'break-all' }}
            >
              {newPubkey}
            </div>
            <div style={{
              fontSize: '0.72rem', color: '#c97070', background: 'rgba(201,112,112,0.08)',
              border: '1px solid rgba(201,112,112,0.2)', borderRadius: 8,
              padding: '0.6rem 0.8rem', marginTop: '0.8rem', lineHeight: 1.5,
            }}>
              {t('migration.verifyHint')}
            </div>
            <div className="modal-actions" style={{ marginTop: '1rem' }}>
              <button className="btn" onClick={close}>{t('migration.done')}</button>
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <div className="modal-title" style={{ color: 'var(--danger)' }}>{t('migration.failedTitle')}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--danger)', padding: '1rem 0' }}>
              {errorMsg}
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={close}>{t('migration.close')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
