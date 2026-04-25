import { useState, useEffect } from 'react'
import { Download, X } from 'lucide-react'
import { useT } from '../../hooks/useT'

const DISMISSED_KEY = 'alina-pwa-dismissed'

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as any).standalone === true
}

export function PwaBanner() {
  const t = useT()
  const [visible, setVisible] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)

  useEffect(() => {
    // Don't show if already installed as PWA or previously dismissed
    if (isStandalone()) return
    const dismissed = sessionStorage.getItem(DISMISSED_KEY)
    if (dismissed) return

    // Show after short delay so it doesn't flash on load
    const timer = setTimeout(() => setVisible(true), 2000)

    // Listen for the browser install prompt
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('beforeinstallprompt', handler)
    }
  }, [])

  const dismiss = () => {
    setVisible(false)
    sessionStorage.setItem(DISMISSED_KEY, '1')
  }

  const install = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      await deferredPrompt.userChoice
      setDeferredPrompt(null)
    }
    dismiss()
  }

  if (!visible) return null

  return (
    <div className="pwa-banner">
      <div className="pwa-banner-text">
        <Download size={16} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>{t('pwa.banner')}</span>
      </div>
      <div className="pwa-banner-actions">
        <button className="btn pwa-install-btn" onClick={install}>{t('pwa.install')}</button>
        <button className="pwa-dismiss-btn" onClick={dismiss}><X size={16} /></button>
      </div>
    </div>
  )
}
