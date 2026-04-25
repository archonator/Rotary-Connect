import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Copy, Check, UserPlus, KeyRound, Fingerprint } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { useT } from '../../hooks/useT'
import { publishInviteCode, lookupInviteCode, resubscribeAll } from '../../lib/nostr'
import { decodeNpub } from '../../lib/crypto'
import { INVITE_CODE_DURATION } from '../../lib/constants'

type View = 'choose' | 'invite' | 'join' | 'pubkey'
type LookupState = 'idle' | 'searching' | 'found' | 'not_found'

export function AddContactModal() {
  const setOpenModal = useStore(s => s.setOpenModal)
  const addContact = useStore(s => s.addContact)
  const showStatus = useStore(s => s.showStatus)
  const identity = useStore(s => s.identity)
  const t = useT()

  const [view, setView] = useState<View>('choose')

  // Invite
  const [inviteName, setInviteName] = useState('')
  const [code, setCode] = useState<string | null>(null)
  const [remaining, setRemaining] = useState(0)
  const [publishing, setPublishing] = useState(false)
  const [copied, setCopied] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Join
  const [joinCode, setJoinCode] = useState('')
  const [inviterName, setInviterName] = useState('')
  const [inviterPubkey, setInviterPubkey] = useState('')
  const [joinName, setJoinName] = useState('')
  const [lookupState, setLookupState] = useState<LookupState>('idle')
  const [lookupDone, setLookupDone] = useState(false)

  // Pubkey
  const [pubkeyInput, setPubkeyInput] = useState('')
  const [pubkeyName, setPubkeyName] = useState('')
  const [pubkeyError, setPubkeyError] = useState('')

  const close = () => setOpenModal(null)

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current) }, [])

  const startCountdown = () => {
    setRemaining(INVITE_CODE_DURATION)
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current)
          setCode(null)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  const generateCode = async () => {
    if (!identity || !inviteName.trim()) return
    setPublishing(true)
    // Use crypto.getRandomValues for secure code generation
    const arr = new Uint32Array(1)
    crypto.getRandomValues(arr)
    const newCode = String(100000 + (arr[0] % 900000)).padStart(6, '0')
    try {
      await publishInviteCode(identity.privkey, identity.pubkey, identity.name, newCode)
      setCode(newCode)
      startCountdown()
    } catch {
      showStatus(t('contact.errorCreating'), 3000)
    } finally {
      setPublishing(false)
    }
  }

  const copyCode = () => {
    if (!code) return
    navigator.clipboard.writeText(code).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

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
        setJoinName(result.name)
        setLookupState('found')
      }
    })
  }, [joinCode, lookupDone])

  const resetJoin = () => {
    setJoinCode('')
    setJoinName('')
    setInviterName('')
    setInviterPubkey('')
    setLookupState('idle')
    setLookupDone(false)
  }

  const handleConfirm = () => {
    if (lookupState !== 'found' || !joinName.trim() || !inviterPubkey) return
    addContact(inviterPubkey, joinName.trim())
    resubscribeAll()
    showStatus(t('contact.added', { name: joinName.trim() }), 3000)
    close()
  }

  const m = Math.floor(remaining / 60).toString().padStart(2, '0')
  const s = (remaining % 60).toString().padStart(2, '0')

  // ── CHOOSE VIEW ──
  if (view === 'choose') {
    return (
      <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && close()}>
        <div className="modal">
          <div className="modal-title">{t('contact.inviteTitle')}</div>
          <div className="modal-subtitle">{t('contact.inviteSubtitle')}</div>

          <button
            className="btn"
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '1rem' }}
            onClick={() => setView('invite')}
          >
            <UserPlus size={18} />
            {t('contact.createCode')}
          </button>

          <button
            className="btn"
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '1rem', background: 'var(--surface2)', color: 'var(--text)', border: '2px solid var(--accent)' }}
            onClick={() => setView('join')}
          >
            <KeyRound size={18} />
            {t('contact.enterCode')}
          </button>

          <button
            className="btn"
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '1rem', background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)' }}
            onClick={() => setView('pubkey')}
          >
            <Fingerprint size={18} />
            {t('contact.addPubkey')}
          </button>

          <button className="btn secondary" style={{ width: '100%' }} onClick={close}>{t('contact.close')}</button>
        </div>
      </div>
    )
  }

  // ── JOIN VIEW ──
  if (view === 'join') {
    return (
      <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && close()}>
        <div className="modal">
          <button className="modal-back-btn" onClick={() => { setView('choose'); resetJoin() }}>
            <ArrowLeft size={15} /> {t('contact.back')}
          </button>

          <div className="modal-title">{t('contact.enterCode')}</div>

          <div className="wave-group">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={joinCode}
              onChange={e => {
                const val = e.target.value.replace(/\D/g, '')
                setJoinCode(val)
                if (val.length < 6) { setLookupState('idle'); setLookupDone(false); setInviterName(''); setJoinName('') }
              }}
              className="wave-input"
              required
              autoFocus
              disabled={lookupState === 'searching'}
            />
            <span className="wave-bar" />
            <label className="wave-label">
              {'123 456'.split('').map((ch, i) => (
                <span key={i} className="label-char" style={{ '--index': i } as React.CSSProperties}>{ch}</span>
              ))}
            </label>
          </div>

          {lookupState === 'searching' && (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '0.85rem', padding: '0.5rem 0' }}>
              {t('contact.searching')}
            </div>
          )}

          {lookupState === 'not_found' && (
            <div style={{ fontSize: '0.82rem', color: '#e07070', background: '#2a1818', border: '1px solid #5a2a2a', borderRadius: 8, padding: '0.7rem 0.9rem' }}>
              {t('contact.notFound')}
            </div>
          )}

          {lookupState === 'found' && (
            <>
              <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {t('contact.invitationFrom')}
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--accent)' }}>
                  {inviterName || t('contact.unknown')}
                </div>
              </div>

              <div>
                <div className="setup-label">{t('contact.saveAs')}</div>
                <input
                  type="text"
                  value={joinName}
                  onChange={e => setJoinName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleConfirm()}
                  maxLength={30}
                  placeholder={inviterName}
                  autoFocus
                />
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.4rem' }}>
                  {t('contact.canRename')}
                </div>
              </div>

              <button
                className="btn"
                style={{ width: '100%' }}
                onClick={handleConfirm}
                disabled={!joinName.trim()}
              >
                {t('contact.addBtn')}
              </button>
            </>
          )}

          <button className="btn secondary" style={{ width: '100%' }} onClick={close}>{t('contact.cancelBtn')}</button>
        </div>
      </div>
    )
  }

  // ── PUBKEY VIEW ──
  if (view === 'pubkey') {
    const handleAddPubkey = () => {
      if (!pubkeyInput.trim() || !pubkeyName.trim()) return
      try {
        const hex = decodeNpub(pubkeyInput.trim())
        addContact(hex, pubkeyName.trim())
        resubscribeAll()
        showStatus(t('contact.pubkeyAdded'), 3000)
        close()
      } catch {
        setPubkeyError(t('contact.pubkeyInvalid'))
      }
    }

    return (
      <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && close()}>
        <div className="modal">
          <button className="modal-back-btn" onClick={() => { setView('choose'); setPubkeyInput(''); setPubkeyName(''); setPubkeyError('') }}>
            <ArrowLeft size={15} /> {t('contact.back')}
          </button>

          <div className="modal-title">{t('contact.addPubkey')}</div>

          <div>
            <div className="setup-label">{t('contact.pubkeyLabel')}</div>
            <input
              type="text"
              placeholder={t('contact.pubkeyPlaceholder')}
              value={pubkeyInput}
              onChange={e => { setPubkeyInput(e.target.value); setPubkeyError('') }}
              style={{ fontSize: '0.78rem', fontFamily: 'monospace' }}
              autoFocus
            />
          </div>

          <div>
            <div className="setup-label">{t('contact.pubkeyName')}</div>
            <input
              type="text"
              placeholder={t('contact.contactNamePlaceholder')}
              maxLength={30}
              value={pubkeyName}
              onChange={e => setPubkeyName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && pubkeyName.trim() && pubkeyInput.trim() && handleAddPubkey()}
            />
          </div>

          {pubkeyError && (
            <div style={{ fontSize: '0.82rem', color: '#e07070', background: '#2a1818', border: '1px solid #5a2a2a', borderRadius: 8, padding: '0.7rem 0.9rem' }}>
              {pubkeyError}
            </div>
          )}

          <button
            className="btn"
            style={{ width: '100%' }}
            onClick={handleAddPubkey}
            disabled={!pubkeyInput.trim() || !pubkeyName.trim()}
          >
            {t('contact.addBtn')}
          </button>

          <button className="btn secondary" style={{ width: '100%' }} onClick={close}>{t('contact.close')}</button>
        </div>
      </div>
    )
  }

  // ── INVITE VIEW ──
  return (
    <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && close()}>
      <div className="modal">
        <button className="modal-back-btn" onClick={() => { setView('choose'); setCode(null); setInviteName('') }}>
          <ArrowLeft size={15} /> {t('contact.back')}
        </button>
        <div className="modal-title">{t('contact.inviteTitle')}</div>
        <div className="modal-subtitle">{t('contact.inviteSubtitle')}</div>

        {!code ? (
          <>
            <div>
              <div className="setup-label">{t('contact.contactNameLabel')}</div>
              <input
                type="text"
                placeholder={t('contact.contactNamePlaceholder')}
                maxLength={30}
                value={inviteName}
                onChange={e => setInviteName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && inviteName.trim() && generateCode()}
                autoFocus
              />
            </div>

            <button
              className="btn"
              style={{ width: '100%' }}
              onClick={generateCode}
              disabled={publishing || !inviteName.trim()}
            >
              <UserPlus size={16} style={{ marginRight: '0.4rem' }} />
              {publishing ? t('contact.creating') : t('contact.createCode')}
            </button>
          </>
        ) : (
          <>
            <div
              onClick={copyCode}
              title={t('contact.tapToCopy')}
              style={{
                textAlign: 'center', cursor: 'pointer',
                background: 'var(--surface2)', border: '2px solid var(--accent)',
                borderRadius: 12, padding: '1.4rem 1rem', position: 'relative',
              }}
            >
              <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {t('contact.codeFor', { name: inviteName })}
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: '2.8rem', letterSpacing: '0.45em', fontWeight: 700, color: 'var(--accent)' }}>
                {code}
              </div>
              <div style={{ fontSize: '0.75rem', color: copied ? 'var(--accent)' : 'var(--muted)', marginTop: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
                {copied ? <><Check size={13} /> {t('contact.copied')}</> : <><Copy size={13} /> {t('contact.tapToCopy')}</>}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: remaining < 60 ? '#e07070' : 'var(--muted)' }}>
              <span>{t('contact.validFor', { m, s })}</span>
              <button className="btn secondary small" onClick={generateCode} disabled={publishing}>
                {t('contact.recreate')}
              </button>
            </div>

            <div style={{ fontSize: '0.82rem', color: 'var(--muted)', lineHeight: 1.6, background: 'var(--surface2)', borderRadius: 8, padding: '0.7rem 0.9rem' }}>
              {t('contact.sendInstruction', { name: inviteName })}
            </div>
          </>
        )}

        <button className="btn secondary" style={{ width: '100%' }} onClick={close}>{t('contact.close')}</button>
      </div>
    </div>
  )
}
