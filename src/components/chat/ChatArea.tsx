import { useState, useEffect, useRef, useCallback } from 'react'
import { MessageCirclePlus, Users, Menu, UserPlus, KeyRound, Hash, Download, ArrowRight, Timer } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { useT } from '../../hooks/useT'
import { ChatHeader } from './ChatHeader'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { Lightbox } from '../ui/Lightbox'

export function ChatArea() {
  const activeChat = useStore(s => s.activeChat)
  const setOpenModal = useStore(s => s.setOpenModal)
  const setSidebarOpen = useStore(s => s.setSidebarOpen)
  const t = useT()
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  // Auto-open sidebar when no chat is active (important for mobile)
  useEffect(() => {
    if (!activeChat) setSidebarOpen(true)
  }, [activeChat, setSidebarOpen])

  // Swipe right from left edge to open sidebar
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    if (!touch) return
    if (touch.clientX < 30) {
      touchStartRef.current = { x: touch.clientX, y: touch.clientY }
    }
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return
    const touch = e.changedTouches[0]
    if (!touch) return
    const dx = touch.clientX - touchStartRef.current.x
    const dy = Math.abs(touch.clientY - touchStartRef.current.y)
    touchStartRef.current = null
    if (dx > 60 && dy < 80) setSidebarOpen(true)
  }, [setSidebarOpen])

  const guideSteps = [
    { icon: <UserPlus size={18} />, title: t('chat.guide1Title'), desc: t('chat.guide1Desc'), action: () => setOpenModal('add-contact') },
    { icon: <ArrowRight size={18} />, title: t('chat.guide2Title'), desc: t('chat.guide2Desc'), action: () => setOpenModal('add-contact') },
    { icon: <Hash size={18} />, title: t('chat.guide3Title'), desc: t('chat.guide3Desc'), action: () => setOpenModal('add-room') },
    { icon: <KeyRound size={18} />, title: t('chat.guide4Title'), desc: t('chat.guide4Desc'), action: () => setOpenModal('settings') },
    { icon: <Timer size={18} />, title: t('chat.guide5Title'), desc: t('chat.guide5Desc') },
    { icon: <Download size={18} />, title: t('chat.guide6Title'), desc: t('chat.guide6Desc') },
  ]

  if (!activeChat) {
    return (
      <div className="chat-area">
        <div className="chat-empty-state">
          {/* Mobile: prominent button to open sidebar */}
          <button
            className="mobile-sidebar-btn"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={22} />
            <span>{t('chat.openSidebar')}</span>
          </button>
          <img src="/logo-icon.svg" alt="Rotary Connect" style={{ width: 56, height: 56, marginBottom: '0.1rem', flexShrink: 0 }} />
          <div style={{ fontFamily: "'Jost', sans-serif", fontWeight: 200, fontSize: '1.8rem', color: 'var(--border)', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>
            Rotary Connect
          </div>
          <p style={{ fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '0.2rem', fontWeight: 500 }}>
            {t('chat.tagline')}
          </p>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '1.5rem', marginTop: '0.8rem' }}>
            <button
              className="btn"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              onClick={() => setOpenModal('add-contact')}
            >
              <MessageCirclePlus size={16} /> {t('chat.inviteSomeone')}
            </button>
            <button
              className="btn secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              onClick={() => setOpenModal('add-room')}
            >
              <Users size={16} /> {t('chat.createGroup')}
            </button>
          </div>

          {/* Guide */}
          <div className="onboarding-guide">
            <div className="onboarding-title">{t('chat.guideTitle')}</div>
            {guideSteps.map((step, i) => (
              <div
                key={i}
                className={`onboarding-step${step.action ? ' clickable' : ''}`}
                onClick={step.action}
                role={step.action ? 'button' : undefined}
                tabIndex={step.action ? 0 : undefined}
                onKeyDown={step.action ? (e) => { if (e.key === 'Enter') step.action!() } : undefined}
              >
                <div className="onboarding-icon">{step.icon}</div>
                <div>
                  <div className="onboarding-step-title">{step.title}</div>
                  <div className="onboarding-step-desc">{step.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-area" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <div id="chat-view" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        <ChatHeader />
        <MessageList onImageClick={setLightboxSrc} />
        <ChatInput />
      </div>
      <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  )
}
