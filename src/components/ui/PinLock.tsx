import { useState, useRef, useEffect } from 'react'
import { isVaultActive, initVault, unlockVault } from '../../lib/vault'
import { loadDecryptedCache, migrateToVault, hasPlaintextData } from '../../lib/storage'

// ── Types ────────────────────────────────────────────────────────

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
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 60_000

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

// ── Helpers ──────────────────────────────────────────────────────

/** Check if a vault or plaintext data requires a PIN gate */
export function needsVaultGate(): boolean {
  return isVaultActive() || hasPlaintextData()
}

/** Determine gate mode */
export function getVaultGateMode(): 'unlock' | 'setup' | 'none' {
  if (isVaultActive()) return 'unlock'
  if (hasPlaintextData()) return 'setup' // migration needed
  return 'none'
}

// ── PinLock (unlock existing vault) ──────────────────────────────

export function PinLock({ onUnlock }: PinLockProps) {
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

        if (newCount >= MAX_ATTEMPTS) {
          const lockedUntil = Date.now() + LOCKOUT_MS
          setAttempts(newCount, lockedUntil)
          setLocked(true)
          setLockRemaining(Math.ceil(LOCKOUT_MS / 1000))
          setError(`Too many attempts. Locked for ${Math.ceil(LOCKOUT_MS / 1000)}s`)
        } else {
          setAttempts(newCount, 0)
          setError(`Wrong PIN (${MAX_ATTEMPTS - newCount} attempts left)`)
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
      <img src="/logo-icon.svg" alt="Rotary" style={{ width: 64, height: 64 }} />
      <div style={{
        fontFamily: "'Jost', sans-serif", fontWeight: 300, fontSize: '1.6rem',
        color: 'var(--accent)', letterSpacing: '0.15em',
      }}>
        Connect
      </div>
      <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
        Enter your PIN to unlock
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
        aria-label="PIN"
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
          Try again in {lockRemaining}s
        </div>
      )}
      {loading && (
        <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
          Unlocking...
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
        Unlock
      </button>
    </div>
  )
}

// ── PinSetup (create new vault or migrate) ───────────────────────

export function PinSetup({ onComplete, isMigration }: PinSetupProps) {
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
    setStep('confirm')
    setError('')
  }

  const handleConfirm = async () => {
    if (confirmPin !== pin) {
      setError('PINs do not match')
      setConfirmPin('')
      return
    }

    setLoading(true)
    try {
      // Create vault with PIN
      await initVault(pin)

      if (isMigration) {
        // Encrypt existing plaintext data
        await migrateToVault()
        // Load decrypted cache (data is now in cache from migration)
        await loadDecryptedCache()
      }

      setPin('')
      setConfirmPin('')
      setAttempts(0, 0)

      // Clean up old PIN system keys
      localStorage.removeItem('alina-pin-hash')
      localStorage.removeItem('alina-pin-salt')
      localStorage.removeItem('alina-pin-attempts')

      onComplete()
    } catch (e) {
      setError('Failed to create vault: ' + String(e))
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
      <img src="/logo-icon.svg" alt="Rotary" style={{ width: 64, height: 64 }} />
      <div style={{
        fontFamily: "'Jost', sans-serif", fontWeight: 300, fontSize: '1.6rem',
        color: 'var(--accent)', letterSpacing: '0.15em',
      }}>
        Connect
      </div>

      {isMigration ? (
        <div style={{ fontSize: '0.85rem', color: 'var(--muted)', textAlign: 'center', maxWidth: 300, lineHeight: 1.6 }}>
          Your data is not yet encrypted. Set a PIN to protect your keys and messages.
        </div>
      ) : (
        <div style={{ fontSize: '0.85rem', color: 'var(--muted)', textAlign: 'center', maxWidth: 300, lineHeight: 1.6 }}>
          Choose a PIN to encrypt your data. You'll need this PIN every time you open Rotary Connect.
        </div>
      )}

      <div style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 500 }}>
        {step === 'enter' ? 'Choose a PIN (4-6 digits)' : 'Confirm your PIN'}
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
        aria-label={step === 'enter' ? 'Choose PIN' : 'Confirm PIN'}
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
          Encrypting your data...
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
            Back
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
          {step === 'enter' ? 'Continue' : 'Encrypt'}
        </button>
      </div>

      <div style={{
        fontSize: '0.72rem', color: '#c97070', background: 'rgba(201,112,112,0.08)',
        border: '1px solid rgba(201,112,112,0.2)', borderRadius: 8,
        padding: '0.6rem 0.8rem', maxWidth: 320, lineHeight: 1.5, textAlign: 'center',
      }}>
        If you forget your PIN, your data cannot be recovered. Make sure to back up your private key (nsec) in Settings.
      </div>
    </div>
  )
}
