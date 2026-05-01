import { useState, useRef, useEffect } from 'react'
import { isVaultActive, initVault, unlockVault } from '../../lib/vault'
import { loadDecryptedCache, migrateToVault, hasPlaintextData } from '../../lib/storage'
import { useT } from '../../hooks/useT'

/**
 * PinLock & PinSetup — Vault-Gate-UI.
 *
 * Diese Datei exportiert zwei Komponenten, die in unterschiedlichen
 * Phasen der App-Phasenmaschine (siehe App.tsx) gemountet werden:
 *
 *   • PinLock     — bestehenden Vault entsperren (User kennt seinen PIN)
 *   • PinSetup    — neuen Vault anlegen (PIN zweimal eingeben, Bestätigung)
 *
 * Außerdem die geteilte Lockout-Logik:
 *   • exponentielles Lockout nach falschen Versuchen (60 s → 5 min →
 *     15 min → 1 h → 6 h → 24 h)
 *   • `isWeakPin()` lehnt offensichtlich schwache PINs ab (4444, 1234,
 *     2580, …) — exportiert für die Tests.
 *
 * Wichtig: das Lockout ist eine UI-seitige Hürde, kein
 * kryptografischer Schutz. Echte Sicherheit gegen Brute Force bringt
 * PBKDF2-600k im Vault selbst (siehe vault.ts).
 */

// ── Typen ────────────────────────────────────────────────────────

interface PinLockProps {
  /** Called after successful vault unlock or setup, with hydration done */
  onUnlock: () => void
}

interface PinSetupProps {
  /** Called after vault is created and data migrated/saved */
  onComplete: () => void
  /** True if migrating existing plaintext data */
  isMigration: boolean
}

// ── Lockout state (persisted outside vault — must be readable before unlock) ──

const ATTEMPTS_KEY = 'alina_pin_attempts'

/**
 * Lockout schedule based on consecutive failed attempts.
 * Capped at 24h. Note this is a UI-side hint — an attacker with device access can
 * clear `localStorage` to skip it; the real protection is PBKDF2-600k inside the vault.
 */
const LOCKOUT_LADDER_MS = [
  0,            // attempts 0..4 — no lock
  0, 0, 0, 0,
  60_000,       // attempt 5  — 1 min
  5 * 60_000,   // attempt 6  — 5 min
  15 * 60_000,  // attempt 7  — 15 min
  60 * 60_000,  // attempt 8  — 1 h
  6 * 3600_000, // attempt 9  — 6 h
  24 * 3600_000,// attempt 10+ — 24 h
] as const

function lockoutForAttempt(count: number): number {
  if (count < LOCKOUT_LADDER_MS.length) return LOCKOUT_LADDER_MS[count] ?? 0
  return LOCKOUT_LADDER_MS[LOCKOUT_LADDER_MS.length - 1] ?? 0
}

/** PINs that are too predictable to be acceptable. */
const WEAK_PINS = new Set([
  '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '1234', '4321', '0123', '1212', '2121', '1004', '2580', '0852',
  '000000', '111111', '222222', '333333', '444444', '555555', '666666',
  '777777', '888888', '999999', '123456', '654321', '012345', '111222',
])

export function isWeakPin(pin: string): boolean {
  if (WEAK_PINS.has(pin)) return true
  // All same digit
  if (/^(\d)\1+$/.test(pin)) return true
  // Strict ascending or descending sequence (e.g. "23456", "98765")
  let asc = true, desc = true
  for (let i = 1; i < pin.length; i++) {
    const a = pin.charCodeAt(i - 1)
    const b = pin.charCodeAt(i)
    if (b !== a + 1) asc = false
    if (b !== a - 1) desc = false
  }
  return asc || desc
}

function getAttempts(): { count: number; lockedUntil: number } {
  try {
    const raw = localStorage.getItem(ATTEMPTS_KEY)
    if (!raw) return { count: 0, lockedUntil: 0 }
    return JSON.parse(raw)
  } catch {
    return { count: 0, lockedUntil: 0 }
  }
}

function setAttempts(count: number, lockedUntil: number): void {
  localStorage.setItem(ATTEMPTS_KEY, JSON.stringify({ count, lockedUntil }))
}

function formatLockout(ms: number): string {
  const s = Math.ceil(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.ceil(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.ceil(m / 60)
  return `${h}h`
}

// ── Helpers ──────────────────────────────────────────────────────

/** Determine gate mode */
export function getVaultGateMode(): 'unlock' | 'setup' | 'none' {
  if (isVaultActive()) return 'unlock'
  if (hasPlaintextData()) return 'setup' // migration needed
  return 'none'
}

// ── PinLock (unlock existing vault) ──────────────────────────────

export function PinLock({ onUnlock }: PinLockProps) {
  const t = useT()
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [shake, setShake] = useState(false)
  const [locked, setLocked] = useState(false)
  const [lockRemaining, setLockRemaining] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const { lockedUntil } = getAttempts()
    if (lockedUntil > Date.now()) {
      setLocked(true)
      setLockRemaining(Math.ceil((lockedUntil - Date.now()) / 1000))
    }
  }, [])

  // Countdown timer for lockout
  useEffect(() => {
    if (!locked) return
    const id = setInterval(() => {
      const { lockedUntil } = getAttempts()
      const remaining = Math.ceil((lockedUntil - Date.now()) / 1000)
      if (remaining <= 0) {
        setLocked(false)
        setLockRemaining(0)
        setError('')
        inputRef.current?.focus()
      } else {
        setLockRemaining(remaining)
      }
    }, 1000)
    return () => clearInterval(id)
  }, [locked])

  const handleSubmit = async () => {
    if (locked || loading || pin.length < 4) return
    setLoading(true)

    try {
      const success = await unlockVault(pin)

      if (success) {
        setPin('')
        setAttempts(0, 0)
        // Decrypt all storage into cache, then hydrate
        await loadDecryptedCache()
        onUnlock()
      } else {
        const attempts = getAttempts()
        const newCount = attempts.count + 1
        const lockoutMs = lockoutForAttempt(newCount)

        if (lockoutMs > 0) {
          const lockedUntil = Date.now() + lockoutMs
          setAttempts(newCount, lockedUntil)
          setLocked(true)
          setLockRemaining(Math.ceil(lockoutMs / 1000))
          setError(t('pin.wrongLocked', { duration: formatLockout(lockoutMs) }))
        } else {
          setAttempts(newCount, 0)
          setError(t('pin.wrongShort'))
        }

        setShake(true)
        setPin('')
        setTimeout(() => setShake(false), 500)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 9999,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '1.5rem', padding: '2rem',
    }}>
      <div style={{
        fontFamily: "'Jost', sans-serif", fontWeight: 200, fontSize: '2.8rem',
        color: 'var(--accent)', letterSpacing: '0.1em', textTransform: 'lowercase',
      }}>
        Rotary Connect
      </div>
      <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
        {t('pin.unlockTitle')}
      </div>
      <input
        ref={inputRef}
        type="password"
        inputMode="numeric"
        maxLength={6}
        value={pin}
        onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setError('') }}
        onKeyDown={handleKeyDown}
        placeholder="••••"
        disabled={locked || loading}
        autoFocus
        aria-label={t('pin.aria')}
        style={{
          width: 160, textAlign: 'center', fontSize: '2rem', letterSpacing: '0.5em',
          background: locked ? 'var(--surface)' : 'var(--surface2)',
          border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
          borderRadius: 12, color: 'var(--text)', padding: '0.8rem',
          outline: 'none', fontFamily: 'monospace',
          animation: shake ? 'shakePin 0.4s ease' : 'none',
          opacity: locked || loading ? 0.5 : 1,
        }}
      />
      {error && (
        <div style={{ fontSize: '0.82rem', color: 'var(--danger)', textAlign: 'center' }}>{error}</div>
      )}
      {locked && lockRemaining > 0 && (
        <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
          {t('pin.tryAgainIn', { n: String(lockRemaining) })}
        </div>
      )}
      {loading && (
        <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
          {t('pin.unlocking')}
        </div>
      )}
      <button
        onClick={handleSubmit}
        disabled={pin.length < 4 || locked || loading}
        style={{
          background: pin.length >= 4 && !locked && !loading ? 'var(--accent)' : 'var(--surface2)',
          color: pin.length >= 4 && !locked && !loading ? '#1a1410' : 'var(--muted)',
          border: 'none', borderRadius: 12, padding: '0.8rem 2rem',
          fontFamily: 'var(--font-body)', fontSize: '0.95rem', fontWeight: 500,
          cursor: pin.length >= 4 && !locked && !loading ? 'pointer' : 'default',
          transition: 'all 0.2s',
        }}
      >
        {t('pin.unlock')}
      </button>
    </div>
  )
}

// ── PinSetup (create new vault or migrate) ───────────────────────

export function PinSetup({ onComplete, isMigration }: PinSetupProps) {
  const t = useT()
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [step, setStep] = useState<'enter' | 'confirm'>('enter')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [step])

  const handleEnter = () => {
    if (pin.length < 4) return
    if (isWeakPin(pin)) {
      setError(t('pin.tooEasy'))
      return
    }
    setStep('confirm')
    setError('')
  }

  const handleConfirm = async () => {
    if (confirmPin !== pin) {
      setError(t('pin.dontMatch'))
      setConfirmPin('')
      return
    }

    setLoading(true)
    try {
      // Vault mit PIN anlegen
      await initVault(pin)

      if (isMigration) {
        // Bestehende Klartext-Daten verschlüsseln
        await migrateToVault()
        await loadDecryptedCache()
      }

      setPin('')
      setConfirmPin('')
      setAttempts(0, 0)

      // Alte PIN-System-Keys aufräumen (vor-Vault-Versionen)
      localStorage.removeItem('alina-pin-hash')
      localStorage.removeItem('alina-pin-salt')
      localStorage.removeItem('alina-pin-attempts')

      onComplete()
    } catch (e) {
      setError(t('pin.failedSetup', { err: String(e) }))
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (step === 'enter') handleEnter()
      else handleConfirm()
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 9999,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '1.5rem', padding: '2rem',
    }}>
      <div style={{
        fontFamily: "'Jost', sans-serif", fontWeight: 200, fontSize: '2.8rem',
        color: 'var(--accent)', letterSpacing: '0.1em', textTransform: 'lowercase',
      }}>
        Rotary Connect
      </div>

      <div style={{ fontSize: '0.85rem', color: 'var(--muted)', textAlign: 'center', maxWidth: 300, lineHeight: 1.6 }}>
        {isMigration ? t('pin.setupHintMigration') : t('pin.setupHintFresh')}
      </div>

      <div style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 500 }}>
        {step === 'enter' ? t('pin.setupChooseTitle') : t('pin.setupConfirmTitle')}
      </div>

      <input
        ref={inputRef}
        type="password"
        inputMode="numeric"
        maxLength={6}
        value={step === 'enter' ? pin : confirmPin}
        onChange={e => {
          const val = e.target.value.replace(/\D/g, '')
          if (step === 'enter') setPin(val)
          else setConfirmPin(val)
          setError('')
        }}
        onKeyDown={handleKeyDown}
        placeholder="••••"
        disabled={loading}
        autoFocus
        aria-label={step === 'enter' ? t('pin.ariaChoose') : t('pin.ariaConfirm')}
        style={{
          width: 160, textAlign: 'center', fontSize: '2rem', letterSpacing: '0.5em',
          background: 'var(--surface2)',
          border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
          borderRadius: 12, color: 'var(--text)', padding: '0.8rem',
          outline: 'none', fontFamily: 'monospace',
          opacity: loading ? 0.5 : 1,
        }}
      />

      {error && (
        <div style={{ fontSize: '0.82rem', color: 'var(--danger)', textAlign: 'center' }}>{error}</div>
      )}

      {loading && (
        <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
          {t('pin.encrypting')}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {step === 'confirm' && (
          <button
            onClick={() => { setStep('enter'); setConfirmPin(''); setError('') }}
            disabled={loading}
            style={{
              background: 'var(--surface2)', color: 'var(--muted)',
              border: 'none', borderRadius: 12, padding: '0.8rem 1.5rem',
              fontFamily: 'var(--font-body)', fontSize: '0.95rem', fontWeight: 500,
              cursor: loading ? 'default' : 'pointer', transition: 'all 0.2s',
            }}
          >
            {t('pin.setupBack')}
          </button>
        )}
        <button
          onClick={step === 'enter' ? handleEnter : handleConfirm}
          disabled={(step === 'enter' ? pin.length < 4 : confirmPin.length < 4) || loading}
          style={{
            background: (step === 'enter' ? pin.length >= 4 : confirmPin.length >= 4) && !loading
              ? 'var(--accent)' : 'var(--surface2)',
            color: (step === 'enter' ? pin.length >= 4 : confirmPin.length >= 4) && !loading
              ? '#1a1410' : 'var(--muted)',
            border: 'none', borderRadius: 12, padding: '0.8rem 2rem',
            fontFamily: 'var(--font-body)', fontSize: '0.95rem', fontWeight: 500,
            cursor: (step === 'enter' ? pin.length >= 4 : confirmPin.length >= 4) && !loading
              ? 'pointer' : 'default',
            transition: 'all 0.2s',
          }}
        >
          {step === 'enter' ? t('pin.setupContinue') : t('pin.setupEncrypt')}
        </button>
      </div>

      <div style={{
        fontSize: '0.72rem', color: '#c97070', background: 'rgba(201,112,112,0.08)',
        border: '1px solid rgba(201,112,112,0.2)', borderRadius: 8,
        padding: '0.6rem 0.8rem', maxWidth: 320, lineHeight: 1.5, textAlign: 'center',
      }}>
        {t('pin.setupBackupWarning')}
      </div>
    </div>
  )
}
