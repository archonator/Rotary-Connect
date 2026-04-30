import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useT } from '../../hooks/useT'
import { encodeNpub, encodeNsec } from '../../lib/crypto'
import { loadLogs, clearLogs as clearStoredLogs } from '../../lib/storage'
import { changeVaultPin, destroyVault } from '../../lib/vault'
import { getWebRTCMode, setWebRTCMode, getTurnConfig, setTurnConfig } from '../../lib/webrtc'
import type { WebRTCMode } from '../../lib/webrtc'
import { LanguageToggle } from '../ui/LanguageToggle'
import { ConfirmDialog } from '../ui/ConfirmDialog'

/**
 * SettingsModal — zentrale Stelle für alle Einstellungen.
 *
 * Sektionen (von oben nach unten):
 *
 *   • Anzeigename — wird in Räumen mit Nachrichten verschickt
 *   • Public Key (npub) — kopierbar, zum Weitergeben an Kontakte
 *   • Secret Key (nsec) — versteckt, nur nach explizitem "Anzeigen";
 *                          BACKUP-WARNUNG, weil Verlust = Daten weg
 *   • Schlüssel rotieren — öffnet KeyMigrationModal
 *   • Auto-Übersetzung — Hauptschalter + Sub-Toggle für externen Fallback
 *   • WebRTC-Modus — Standard (STUN) vs. Privat (TURN) mit Credentials
 *   • Vault-PIN ändern — Old-PIN + zweimal New-PIN
 *   • Sprache, Logout, Debug-Logs
 *
 * Die LogViewer-Subkomponente ist hier integriert, weil sie nur als
 * Sub-Modal von Settings aufgerufen wird — kein separates Modal-File.
 */
export function SettingsModal() {
  const identity = useStore(s => s.identity)
  const updateName = useStore(s => s.updateName)
  const logout = useStore(s => s.logout)
  const setOpenModal = useStore(s => s.setOpenModal)
  const showStatus = useStore(s => s.showStatus)
  const autoTranslate = useStore(s => s.autoTranslate)
  const setAutoTranslate = useStore(s => s.setAutoTranslate)
  const allowExternalTranslation = useStore(s => s.allowExternalTranslation)
  const setAllowExternalTranslation = useStore(s => s.setAllowExternalTranslation)
  const t = useT()

  const [name, setName] = useState(identity?.name ?? '')
  const [showLogs, setShowLogs] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [keyVisible, setKeyVisible] = useState(false)

  // WebRTC mode state
  const [webrtcMode, setWebrtcModeLocal] = useState<WebRTCMode>(getWebRTCMode())
  const [turnUrl, setTurnUrl] = useState(() => getTurnConfig().url)
  const [turnUser, setTurnUser] = useState(() => getTurnConfig().username)
  const [turnPass, setTurnPass] = useState(() => getTurnConfig().credential)
  const [showTurnConfig, setShowTurnConfig] = useState(false)

  // PIN change state
  const [showPinChange, setShowPinChange] = useState(false)
  const [oldPin, setOldPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmNewPin, setConfirmNewPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [pinLoading, setPinLoading] = useState(false)

  if (!identity) return null

  const npub = encodeNpub(identity.pubkey)
  const nsec = encodeNsec(identity.privkey)

  const close = () => setOpenModal(null)

  const handleSave = () => {
    if (name.trim()) updateName(name.trim())
    close()
  }

  const handleLogout = () => {
    setShowLogoutConfirm(true)
  }

  const confirmLogout = () => {
    destroyVault()
    logout()
    close()
  }

  const copyToClipboard = (text: string, msg: string) => {
    navigator.clipboard.writeText(text).then(() => showStatus(msg, 2000)).catch(() => {})
  }

  const handlePinChange = async () => {
    if (newPin.length < 4) {
      setPinError('PIN must be at least 4 digits')
      return
    }
    if (newPin !== confirmNewPin) {
      setPinError('New PINs do not match')
      setConfirmNewPin('')
      return
    }
    setPinLoading(true)
    setPinError('')
    try {
      const success = await changeVaultPin(oldPin, newPin)
      if (success) {
        showStatus('PIN changed', 2000)
        setShowPinChange(false)
        setOldPin('')
        setNewPin('')
        setConfirmNewPin('')
      } else {
        setPinError('Wrong current PIN')
        setOldPin('')
      }
    } catch {
      setPinError('Failed to change PIN')
    } finally {
      setPinLoading(false)
    }
  }

  return (
    <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && close()}>
      <div className="modal">
        <div className="modal-title">{t('settings.title')}</div>

        <div>
          <div className="setup-label">{t('settings.nameLabel')}</div>
          <input type="text" maxLength={30} value={name} onChange={e => setName(e.target.value)} />
        </div>

        <div>
          <div className="setup-label">{t('settings.pubkeyLabel')}</div>
          <div className="key-display" onClick={() => copyToClipboard(npub, t('settings.pubkeyCopied'))}>
            {npub}
          </div>
        </div>

        <div>
          <div className="setup-label">{t('settings.privkeyLabel')}</div>
          <div
            className="key-display"
            onClick={() => keyVisible ? copyToClipboard(nsec, t('settings.privkeyCopied')) : setKeyVisible(true)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}
          >
            <span>{keyVisible ? nsec : '••••••••••••••••••••••••'}</span>
            <button
              className="btn icon-btn"
              onClick={e => { e.stopPropagation(); setKeyVisible(v => !v) }}
              style={{ fontSize: '0.72rem', padding: '0.2rem 0.4rem' }}
              aria-label={keyVisible ? 'Hide key' : 'Show key'}
            >
              {keyVisible ? '🙈' : '👁'}
            </button>
          </div>
        </div>

        <div className="warning-box">{t('settings.keyWarning')}</div>

        {/* Key Rotation */}
        <button
          className="btn secondary small"
          style={{ fontSize: '0.78rem' }}
          onClick={() => setOpenModal('key-migration')}
        >
          Rotate Key
        </button>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            className="alina-checkbox"
            checked={autoTranslate}
            onChange={() => setAutoTranslate(!autoTranslate)}
          />
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)' }}>{t('translate.autoTranslate')}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.15rem' }}>{t('translate.autoTranslateSub')}</div>
          </div>
        </label>

        {autoTranslate && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                className="alina-checkbox"
                checked={allowExternalTranslation}
                onChange={() => setAllowExternalTranslation(!allowExternalTranslation)}
              />
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)' }}>{t('translate.externalFallback')}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.15rem' }}>{t('translate.externalFallbackSub')}</div>
              </div>
            </label>
            {allowExternalTranslation && (
              <div style={{
                fontSize: '0.72rem', color: '#c97070', background: 'rgba(201,112,112,0.08)',
                border: '1px solid rgba(201,112,112,0.2)', borderRadius: 6,
                padding: '0.5rem 0.65rem', lineHeight: 1.5,
              }}>
                ⚠ {t('translate.externalWarning')}
              </div>
            )}
          </div>
        )}

        {/* WebRTC Mode Toggle */}
        <div>
          <div style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)', marginBottom: '0.4rem' }}>
            WebRTC Mode
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button
              className={`btn small ${webrtcMode === 'standard' ? '' : 'secondary'}`}
              style={{ fontSize: '0.78rem', flex: 1 }}
              onClick={() => {
                setWebrtcModeLocal('standard')
                setWebRTCMode('standard')
              }}
            >
              ⚡ Standard (STUN)
            </button>
            <button
              className={`btn small ${webrtcMode === 'private' ? '' : 'secondary'}`}
              style={{ fontSize: '0.78rem', flex: 1 }}
              onClick={() => {
                setWebrtcModeLocal('private')
                setWebRTCMode('private')
                if (!turnUrl) setShowTurnConfig(true)
              }}
            >
              🛡 Private (TURN)
            </button>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.35rem', lineHeight: 1.5 }}>
            {webrtcMode === 'standard'
              ? 'Direct P2P — fast, but peers can see each other\'s IP address.'
              : 'Relay via TURN server — hides your IP, requires a TURN server.'}
          </div>

          {webrtcMode === 'private' && !turnUrl && !showTurnConfig && (
            <div style={{
              fontSize: '0.72rem', color: '#c97070', background: 'rgba(201,112,112,0.08)',
              border: '1px solid rgba(201,112,112,0.2)', borderRadius: 6,
              padding: '0.5rem 0.65rem', lineHeight: 1.5, marginTop: '0.35rem',
            }}>
              ⚠ No TURN server configured. Private mode won't work without one.
            </div>
          )}

          {(showTurnConfig || (webrtcMode === 'private' && turnUrl)) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.5rem' }}>
              <input
                type="text"
                placeholder="TURN URL (e.g. turn:relay.example.com:3478)"
                value={turnUrl}
                onChange={e => setTurnUrl(e.target.value)}
                style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}
              />
              <input
                type="text"
                placeholder="Username"
                value={turnUser}
                onChange={e => setTurnUser(e.target.value)}
                style={{ fontSize: '0.8rem' }}
              />
              <input
                type="password"
                placeholder="Credential"
                value={turnPass}
                onChange={e => setTurnPass(e.target.value)}
                style={{ fontSize: '0.8rem' }}
              />
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button
                  className="btn small"
                  style={{ fontSize: '0.78rem' }}
                  onClick={() => {
                    setTurnConfig({ url: turnUrl.trim(), username: turnUser.trim(), credential: turnPass })
                    showStatus('TURN config saved', 2000)
                    setShowTurnConfig(false)
                  }}
                  disabled={!turnUrl.trim()}
                >
                  Save TURN
                </button>
                {turnUrl && (
                  <button
                    className="btn secondary small"
                    style={{ fontSize: '0.78rem' }}
                    onClick={() => {
                      setTurnUrl('')
                      setTurnUser('')
                      setTurnPass('')
                      setTurnConfig({ url: '', username: '', credential: '' })
                      setWebrtcModeLocal('standard')
                      setWebRTCMode('standard')
                      showStatus('TURN config removed', 2000)
                      setShowTurnConfig(false)
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          )}

          {webrtcMode === 'standard' && turnUrl && (
            <button
              className="btn secondary small"
              style={{ fontSize: '0.72rem', marginTop: '0.35rem' }}
              onClick={() => setShowTurnConfig(true)}
            >
              Edit TURN config
            </button>
          )}
        </div>

        {/* Vault PIN Management */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)' }}>Encryption PIN</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.15rem' }}>
                Your data is encrypted with AES-256-GCM
              </div>
            </div>
          </div>
          {!showPinChange ? (
            <button
              className="btn secondary small"
              style={{ marginTop: '0.5rem', fontSize: '0.78rem' }}
              onClick={() => setShowPinChange(true)}
            >
              Change PIN
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.5rem' }}>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                placeholder="Current PIN"
                value={oldPin}
                onChange={e => { setOldPin(e.target.value.replace(/\D/g, '')); setPinError('') }}
                style={{ fontSize: '0.85rem', letterSpacing: '0.2em', textAlign: 'center', fontFamily: 'monospace' }}
                autoFocus
              />
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                placeholder="New PIN (4-6 digits)"
                value={newPin}
                onChange={e => { setNewPin(e.target.value.replace(/\D/g, '')); setPinError('') }}
                style={{ fontSize: '0.85rem', letterSpacing: '0.2em', textAlign: 'center', fontFamily: 'monospace' }}
              />
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                placeholder="Confirm new PIN"
                value={confirmNewPin}
                onChange={e => { setConfirmNewPin(e.target.value.replace(/\D/g, '')); setPinError('') }}
                onKeyDown={e => e.key === 'Enter' && handlePinChange()}
                style={{ fontSize: '0.85rem', letterSpacing: '0.2em', textAlign: 'center', fontFamily: 'monospace' }}
              />
              {pinError && (
                <div style={{ fontSize: '0.78rem', color: 'var(--danger)' }}>{pinError}</div>
              )}
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button
                  className="btn small"
                  onClick={handlePinChange}
                  disabled={oldPin.length < 4 || newPin.length < 4 || confirmNewPin.length < 4 || pinLoading}
                >
                  {pinLoading ? 'Changing...' : 'Save'}
                </button>
                <button
                  className="btn secondary small"
                  onClick={() => {
                    setShowPinChange(false)
                    setOldPin('')
                    setNewPin('')
                    setConfirmNewPin('')
                    setPinError('')
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="setup-label">{t('settings.language')}</div>
          <LanguageToggle />
        </div>

        <div style={{ fontSize: '0.68rem', color: 'var(--muted)', textAlign: 'center', paddingTop: '0.5rem', letterSpacing: '0.05em' }}>
          © 2026 Kay (__archon) Muehlenbruch · MIT License
        </div>

        <div className="modal-actions" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
          <button className="btn danger small" onClick={handleLogout}>{t('settings.signout')}</button>
          <button className="btn secondary small" onClick={() => setShowLogs(true)} title="View error logs">🪲 {t('settings.logs')}</button>
          <button className="btn secondary" onClick={close}>{t('settings.close')}</button>
          <button className="btn" onClick={handleSave}>{t('settings.save')}</button>
        </div>
      </div>

      {showLogs && <LogViewer onClose={() => setShowLogs(false)} />}
      {showLogoutConfirm && (
        <ConfirmDialog
          title={t('settings.signout')}
          message={t('settings.signoutConfirm')}
          confirmLabel={t('settings.signout')}
          cancelLabel={t('settings.close')}
          onConfirm={confirmLogout}
          onCancel={() => setShowLogoutConfirm(false)}
          danger
        />
      )}
    </div>
  )
}

function LogViewer({ onClose }: { onClose: () => void }) {
  const logs = loadLogs()
  const showStatus = useStore(s => s.showStatus)
  const t = useT()

  const handleCopy = () => {
    const text = logs.map(l => `[${l.ts}] [${l.type.toUpperCase()}] ${l.message}`).join('\n')
    navigator.clipboard.writeText(text).then(() => showStatus(t('settings.logsCopied'), 2000))
  }

  const handleClear = () => {
    clearStoredLogs()
    showStatus(t('settings.logsCleared'), 2000)
    onClose()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: '#0a0e14', border: '1px solid #243044', borderRadius: 12, width: '100%', maxWidth: 700, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.8rem 1rem', borderBottom: '1px solid #243044' }}>
          <span style={{ fontSize: '0.85rem', color: '#F7A81B', fontWeight: 500 }}>{t('settings.logsTitle', { n: String(logs.length) })}</span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={handleCopy} style={{ background: '#222226', border: '1px solid #243044', color: '#7a7672', borderRadius: 6, padding: '0.3rem 0.7rem', fontSize: '0.75rem', cursor: 'pointer' }}>{t('settings.copy')}</button>
            <button onClick={handleClear} style={{ background: '#222226', border: '1px solid #243044', color: '#7a7672', borderRadius: 6, padding: '0.3rem 0.7rem', fontSize: '0.75rem', cursor: 'pointer' }}>{t('settings.clear')}</button>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#7a7672', fontSize: '1.1rem', cursor: 'pointer' }}>✕</button>
          </div>
        </div>
        <div style={{ overflowY: 'auto', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {!logs.length && (
            <div style={{ textAlign: 'center', color: '#7a7672', padding: '2rem', fontSize: '0.82rem' }}>{t('settings.noLogs')}</div>
          )}
          {[...logs].reverse().map((log, i) => {
            const color = log.type === 'error' || log.type === 'onerror' ? '#c97070'
              : log.type === 'warn' ? '#c8956a'
              : log.type === 'promise' ? '#c97070'
              : '#7a7672'
            return (
              <div key={i} style={{
                fontFamily: 'monospace', fontSize: '0.72rem', lineHeight: 1.5, padding: '0.4rem 0.6rem',
                background: '#18181b', borderRadius: 4, borderLeft: `2px solid ${color}`,
              }}>
                <span style={{ color: '#5a5448' }}>{log.ts.slice(11, 19)}</span>{' '}
                <span style={{ color, textTransform: 'uppercase', fontSize: '0.65rem' }}>{log.type}</span>{' '}
                <span style={{ color: '#c8bfaa' }}>{log.message}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
