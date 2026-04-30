import { useState, useEffect } from 'react'
import { KeyRound } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { useT } from '../../hooks/useT'
import { lookupInviteCode, resubscribeAll, connectAllRelays, disconnectAllRelays } from '../../lib/nostr'
import { LanguageToggle } from '../ui/LanguageToggle'

type LookupState = 'idle' | 'searching' | 'found' | 'not_found'

interface SetupScreenProps {
  onIdentityCreated?: () => void
}

export function SetupScreen({ onIdentityCreated }: SetupScreenProps = {}) {
  const createIdentity = useStore(s => s.createIdentity)
  const importIdentity = useStore(s => s.importIdentity)
  const addContact = useStore(s => s.addContact)
  const t = useT()

  const [setupName, setSetupName] = useState('')
  const [setupError, setSetupError] = useState('')
  const [importKey, setImportKey] = useState('')
  const [importName, setImportName] = useState('')
  const [importError, setImportError] = useState('')
  const [showImport, setShowImport] = useState(false)

  // Invite code flow
  const [showInvite, setShowInvite] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [inviterName, setInviterName] = useState('')
  const [inviterPubkey, setInviterPubkey] = useState('')
  const [myName, setMyName] = useState('')
  const [lookupState, setLookupState] = useState<LookupState>('idle')
  const [lookupDone, setLookupDone] = useState(false)

  // Connect relays when invite flow is opened (no identity yet → relays not connected)
  useEffect(() => {
    if (showInvite) {
      connectAllRelays()
      return () => { disconnectAllRelays() }
    }
  }, [showInvite])

  const handleCreate = () => {
    if (!setupName.trim()) { setSetupError(t('setup.errorName')); return }
    setSetupError('')
    createIdentity(setupName.trim())
    onIdentityCreated?.()
  }

  const handleImport = () => {
    if (!importKey.trim() || !importName.trim()) {
      setImportError(t('setup.errorFields'))
      return
    }
    setImportError('')
    try {
      importIdentity(importKey.trim(), importName.trim())
      onIdentityCreated?.()
    } catch {
      setImportError(t('setup.errorKey'))
    }
  }

  // Auto-lookup when 6 digits entered
  useEffect(() => {
    if (joinCode.length !== 6 || lookupDone) return
    setLookupState('searching')
    lookupInviteCode(joinCode).then(result => {
      setLookupDone(true)
      if (!result) {
        setLookupState('not_found')
      } else {
        setInviterName(result.name)
        setInviterPubkey(result.pubkey)
        setMyName('')
        setLookupState('found')
      }
    })
  }, [joinCode, lookupDone])

  const handleJoin = () => {
    if (lookupState !== 'found' || !myName.trim() || !inviterPubkey) return
    // Zustand updates are synchronous, so createIdentity → addContact → resubscribe
    // can run in order without timing tricks.
    createIdentity(myName.trim())
    addContact(inviterPubkey, inviterName)
    resubscribeAll()
    onIdentityCreated?.()
  }

  const resetInvite = () => {
    setJoinCode('')
    setInviterName('')
    setInviterPubkey('')
    setMyName('')
    setLookupState('idle')
    setLookupDone(false)
  }

  return (
    <div id="screen-setup" className="screen active">
      <div className="setup-inner">
        <div className="logo-block">
          <img src="/logo-icon.svg" alt="Rotary Connect" className="setup-logo-img" />
          <div className="logo-name">Rotary Connect</div>
          <div className="logo-tagline">{t('setup.tagline')}</div>
          <div style={{ marginTop: '0.8rem' }}>
            <LanguageToggle />
          </div>
        </div>

        {/* ── INVITE CODE SECTION ── */}
        {showInvite ? (
          <div className="setup-card" style={{ borderColor: 'var(--accent)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
              <KeyRound size={16} style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--accent)' }}>{t('setup.enterCode')}</span>
            </div>

            <div className="wave-group">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={joinCode}
                onChange={e => {
                  const val = e.target.value.replace(/\D/g, '')
                  setJoinCode(val)
                  if (val.length < 6) { setLookupState('idle'); setLookupDone(false); setInviterName(''); setMyName('') }
                }}
                className="wave-input"
                required
                autoFocus
                disabled={lookupState === 'searching'}
              />
              <span className="wave-bar" />
              <label className="wave-label">
                {'000000'.split('').map((ch, i) => (
                  <span key={i} className="label-char" style={{ '--index': i } as React.CSSProperties}>{ch}</span>
                ))}
              </label>
            </div>

            {lookupState === 'searching' && (
              <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '0.85rem' }}>
                {t('setup.searching')}
              </div>
            )}

            {lookupState === 'not_found' && (
              <div style={{ fontSize: '0.82rem', color: '#e07070', background: '#2a1818', border: '1px solid #5a2a2a', borderRadius: 8, padding: '0.7rem 0.9rem' }}>
                {t('setup.notFound')}
              </div>
            )}

            {lookupState === 'found' && (
              <>
                <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.8rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {t('setup.inviteFrom')}
                  </div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--accent)' }}>
                    {inviterName}
                  </div>
                </div>

                <div>
                  <div className="setup-label">{t('setup.yourName')}</div>
                  <input
                    type="text"
                    placeholder={t('setup.namePlaceholder')}
                    maxLength={30}
                    value={myName}
                    onChange={e => setMyName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && myName.trim() && handleJoin()}
                    autoFocus
                  />
                </div>

                <button className="btn" style={{ width: '100%' }} onClick={handleJoin} disabled={!myName.trim()}>
                  {t('setup.joinBtn')}
                </button>
              </>
            )}

            <button
              className="btn secondary"
              style={{ width: '100%', fontSize: '0.82rem' }}
              onClick={() => { setShowInvite(false); resetInvite() }}
            >
              {t('setup.hurra')}
            </button>
          </div>
        ) : (
          <>
            {/* ── INVITE CODE BUTTON ── */}
            <button
              className="btn"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '1rem',
                fontSize: '1rem',
                background: 'var(--accent)',
                color: '#1a1410',
                fontWeight: 600,
              }}
              onClick={() => setShowInvite(true)}
            >
              <KeyRound size={18} />
              {t('setup.haveCode')}
            </button>

            {/* ── CREATE NEW (primary flow) ── */}
            <div className="setup-card">
              <div>
                <div className="setup-label">{t('setup.nameLabel')}</div>
                <input
                  type="text"
                  placeholder={t('setup.namePlaceholder')}
                  maxLength={30}
                  value={setupName}
                  onChange={e => { setSetupName(e.target.value); setSetupError('') }}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  autoFocus
                />
              </div>
              {setupError && (
                <div style={{ fontSize: '0.82rem', color: '#e07070', background: '#2a1818', border: '1px solid #5a2a2a', borderRadius: 8, padding: '0.6rem 0.8rem' }}>
                  {setupError}
                </div>
              )}
              <div className="warning-box" style={{ fontSize: '0.82rem', lineHeight: 1.6 }}>{t('setup.keyWarning')}</div>
              <button className="btn" style={{ width: '100%', padding: '0.9rem', fontSize: '1rem', fontWeight: 600 }} onClick={handleCreate}>{t('setup.createBtn')}</button>
            </div>

            {/* ── RESTORE (collapsed by default) ── */}
            {!showImport ? (
              <button
                onClick={() => setShowImport(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted)',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  padding: '0.5rem',
                  textDecoration: 'underline',
                  fontFamily: 'var(--font-body)',
                }}
              >
                {t('setup.orImport')}
              </button>
            ) : (
              <div className="setup-card" style={{ opacity: 0.9 }}>
                <div>
                  <div className="setup-label">{t('setup.privkeyLabel')}</div>
                  <input
                    type="text"
                    placeholder="nsec1..."
                    value={importKey}
                    onChange={e => { setImportKey(e.target.value); setImportError('') }}
                    style={{ fontSize: '0.78rem', fontFamily: 'monospace' }}
                  />
                </div>
                <div>
                  <div className="setup-label">{t('setup.nameLabel')}</div>
                  <input
                    type="text"
                    placeholder={t('setup.importNamePlaceholder')}
                    maxLength={30}
                    value={importName}
                    onChange={e => { setImportName(e.target.value); setImportError('') }}
                    onKeyDown={e => e.key === 'Enter' && handleImport()}
                  />
                </div>
                {importError && (
                  <div style={{ fontSize: '0.82rem', color: '#e07070', background: '#2a1818', border: '1px solid #5a2a2a', borderRadius: 8, padding: '0.6rem 0.8rem' }}>
                    {importError}
                  </div>
                )}
                <button className="btn secondary" onClick={handleImport}>{t('setup.importBtn')}</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
