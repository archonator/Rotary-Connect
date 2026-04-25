import { useState, useEffect, memo } from 'react'
import { MapPin, Timer, Check, AlertCircle, Loader } from 'lucide-react'
import type { Message } from '../../store/useStore'
import { useStore } from '../../store/useStore'
import { useT } from '../../hooks/useT'
import { formatTime } from '../../lib/utils'
import { translate, getLangName } from '../../lib/translate'

interface MessageBubbleProps {
  msg: Message
  isMine: boolean
  isRoom: boolean
  senderName?: string
  onImageClick: (src: string) => void
  onRetry?: (msg: Message) => void
}

export const MessageBubble = memo(function MessageBubble({ msg, isMine, isRoom, senderName, onImageClick, onRetry }: MessageBubbleProps) {
  const lang = useStore(s => s.lang)
  const autoTranslate = useStore(s => s.autoTranslate)
  const allowExternalTranslation = useStore(s => s.allowExternalTranslation)
  const setMessageTranslation = useStore(s => s.setMessageTranslation)
  const activeChat = useStore(s => s.activeChat)
  const t = useT()

  const [showOriginal, setShowOriginal] = useState(false)
  const [translating, setTranslating] = useState(false)
  // Trigger translation for incoming text messages
  useEffect(() => {
    if (
      !autoTranslate ||
      isMine ||
      msg.type !== 'text' ||
      !msg.content ||
      msg.translated ||
      !activeChat
    ) return

    setTranslating(true)
    translate(msg.content, lang, allowExternalTranslation).then(result => {
      setTranslating(false)
      // Only store if it's actually a different language
      if (result.from !== lang && result.text !== msg.content) {
        setMessageTranslation(activeChat.chatId, msg.ts, msg.pubkey, result.text, result.from)
      }
    }).catch(() => setTranslating(false))
  }, [autoTranslate, msg.content, msg.translated, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ephemeral countdown
  const [remaining, setRemaining] = useState<number | null>(null)
  useEffect(() => {
    if (!msg.expiresAt) return
    const update = () => {
      const left = Math.max(0, Math.ceil((msg.expiresAt! - Date.now()) / 1000))
      setRemaining(left)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [msg.expiresAt])

  const isEphemeral = !!msg.expiresAt
  const ephemeralLabel = remaining !== null && remaining > 0
    ? remaining >= 3600 ? `${Math.ceil(remaining / 3600)}h`
      : remaining >= 60 ? `${Math.ceil(remaining / 60)}m`
      : `${remaining}s`
    : null

  const displayText = msg.type === 'text'
    ? (msg.translated && !showOriginal ? msg.translated : msg.content)
    : msg.content

  const statusIcon = isMine && msg.status === 'sending' ? (
    <Loader size={10} className="spin-icon" style={{ opacity: 0.6 }} />
  ) : isMine && msg.status === 'sent' ? (
    <Check size={10} style={{ opacity: 0.5 }} />
  ) : isMine && msg.status === 'failed' ? (
    <button
      className="msg-retry-btn"
      onClick={(e) => { e.stopPropagation(); onRetry?.(msg) }}
      title={t('msg.retry')}
      aria-label={t('msg.retry')}
    >
      <AlertCircle size={12} />
    </button>
  ) : null

  return (
    <div className={`msg-row ${isMine ? 'mine' : 'theirs'}${isEphemeral ? ' ephemeral' : ''}${msg.status === 'failed' ? ' failed' : ''}`}>
      {!isMine && isRoom && senderName && (
        <div className="msg-sender">{senderName}</div>
      )}
      {msg.type === 'image' ? (
        <div className="msg-bubble image-msg">
          <img
            src={msg.content}
            alt="Image"
            onClick={() => onImageClick(msg.content)}
            style={{ width: '100%', maxWidth: 260, maxHeight: 260, borderRadius: 10, display: 'block', cursor: 'pointer', objectFit: 'contain' }}
          />
        </div>
      ) : msg.type === 'location' ? (
        <LocationBubble content={msg.content} isMine={isMine} openMapLabel={t('msg.openMap')} />
      ) : (
        <div className="msg-bubble">{displayText}</div>
      )}

      {/* Translation meta row */}
      {msg.type === 'text' && !isMine && (
        <div className="msg-translate-row">
          {translating && (
            <span className="msg-translate-hint">{t('translate.translating')}</span>
          )}
          {msg.translated && msg.detectedLang && (
            <>
              <span className="msg-translate-hint">
                {t('translate.from', { lang: getLangName(msg.detectedLang) })}
              </span>
              <button
                className="msg-translate-toggle"
                onClick={() => setShowOriginal(p => !p)}
              >                {showOriginal ? t('translate.showTranslation') : t('translate.showOriginal')}
              </button>
            </>
          )}
        </div>
      )}

      <div className="msg-time">
        {formatTime(msg.ts, lang)}
        {isEphemeral && ephemeralLabel && (
          <span className="msg-ephemeral-badge">
            <Timer size={11} />
            {ephemeralLabel}
          </span>
        )}
        {statusIcon && <span className="msg-status-icon">{statusIcon}</span>}
      </div>
    </div>
  )
})

function LocationBubble({ content, isMine, openMapLabel }: { content: string; isMine: boolean; openMapLabel: string }) {
  try {
    const data = JSON.parse(content)
    const lat = data.lat
    const lng = data.lng
    if (typeof lat !== 'number' || typeof lng !== 'number') throw new Error('invalid')
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new Error('out of range')
    if (!isFinite(lat) || !isFinite(lng)) throw new Error('not finite')
    const mapUrl = `https://www.google.com/maps?q=${lat},${lng}`
    const previewUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=15&size=280x160&markers=color:red%7C${lat},${lng}&scale=2&format=jpg`
    return (
      <div className="msg-bubble location-msg" style={{ flexDirection: 'column', gap: '0.4rem', padding: 0, overflow: 'hidden' }}>
        <a href={mapUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'block' }}>
          <img
            src={previewUrl}
            alt={`📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}`}
            style={{ width: '100%', maxWidth: 280, display: 'block', borderRadius: '10px 10px 0 0' }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.7rem 0.5rem' }}>
          <MapPin size={16} style={{ flexShrink: 0 }} />
          <div>
            <div className="location-words">{`${lat.toFixed(4)}, ${lng.toFixed(4)}`}</div>
            <a
              className={`location-link${isMine ? ' mine' : ''}`}
              href={mapUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {openMapLabel}
            </a>
          </div>
        </div>
      </div>
    )
  } catch {
    return <div className="msg-bubble">{content}</div>
  }
}
