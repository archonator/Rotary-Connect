import { useState, useRef, useCallback } from 'react'
import { ImagePlus, MapPin, Send, Loader } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { useT } from '../../hooks/useT'
import { publishDM, publishRoomMessage, getRelayCount } from '../../lib/nostr'
import { enqueue, isOnline } from '../../lib/offlineQueue'
import { EmojiPicker } from './EmojiPicker'
import { ImagePreview } from './ImagePreview'
import { TtlPicker } from './TtlPicker'

export function ChatInput() {
  const activeChat = useStore(s => s.activeChat)
  const identity = useStore(s => s.identity)
  const addMessage = useStore(s => s.addMessage)
  const updateMessageStatus = useStore(s => s.updateMessageStatus)
  const showStatus = useStore(s => s.showStatus)
  const hideStatus = useStore(s => s.hideStatus)
  const t = useT()

  const [text, setText] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [ttl, setTtl] = useState(0) // 0 = normal message, >0 = self-destruct in seconds
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px' }
  }, [])

  const publishMessage = async (msgData: { type: string; content: string }) => {
    if (!activeChat || !identity) return
    const now = Date.now()
    const localMsg = {
      type: msgData.type as 'text' | 'image' | 'location',
      content: msgData.content,
      pubkey: identity.pubkey,
      ts: now,
      ...(ttl > 0 ? { ttl, expiresAt: now + ttl * 1000 } : {}),
      status: 'sending' as const,
    }
    addMessage(activeChat.chatId, localMsg)

    // Include TTL in the wire payload so the receiver knows it's ephemeral
    const wireData = ttl > 0 ? { ...msgData, ttl } : msgData

    // If offline or no relays connected, queue for later
    if (!isOnline() || getRelayCount() === 0) {
      enqueue({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        chatType: activeChat.type,
        chatId: activeChat.chatId,
        recipientOrRoomHash: activeChat.id,
        msgData: activeChat.type === 'room' ? { ...wireData, name: identity.name } : wireData,
        timestamp: Date.now(),
      })
      updateMessageStatus(activeChat.chatId, now, identity.pubkey, 'sent')
      showStatus(t('input.queuedOffline'), 3000)
      return
    }

    setSending(true)
    try {
      if (activeChat.type === 'dm') {
        await publishDM(identity.privkey, identity.pubkey, activeChat.id, wireData)
      } else {
        await publishRoomMessage(identity.privkey, identity.pubkey, activeChat.id, { ...wireData, name: identity.name })
      }
      updateMessageStatus(activeChat.chatId, now, identity.pubkey, 'sent')
    } catch (e) {
      console.warn('Publish failed:', e)
      updateMessageStatus(activeChat.chatId, now, identity.pubkey, 'failed')
    } finally {
      setSending(false)
    }
  }

  const handleSend = async () => {
    if (!text.trim() || sending) return
    const content = text.trim()
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    await publishMessage({ type: 'text', content })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    e.target.value = ''
  }

  const handleImageSend = async (dataUrl: string) => {
    setImageFile(null)
    await publishMessage({ type: 'image', content: dataUrl })
  }

  const handleLocation = () => {
    if (!navigator.geolocation) { showStatus(t('input.locationUnavailable'), 3000); return }
    showStatus(t('input.locating'))
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        hideStatus()
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        await publishMessage({ type: 'location', content: JSON.stringify({ lat, lng }) })
      },
      () => { hideStatus(); showStatus(t('input.locationDenied'), 3000) },
    )
  }

  if (!activeChat) return null

  return (
    <div className="chat-input-bar" onClick={() => setEmojiOpen(false)}>
      {imageFile && (
        <ImagePreview
          file={imageFile}
          onSend={handleImageSend}
          onCancel={() => setImageFile(null)}
        />
      )}
      <EmojiPicker open={emojiOpen} onSelect={emoji => { setText(prev => prev + emoji); textareaRef.current?.focus() }} onClose={() => setEmojiOpen(false)} />

      <button className="attach-btn" onClick={() => fileInputRef.current?.click()} title={t('input.sendImage')} aria-label={t('input.sendImage')}>
        <ImagePlus size={18} />
      </button>
      <button className="loc-btn" onClick={handleLocation} title={t('input.sendLocation')} aria-label={t('input.sendLocation')}>
        <MapPin size={18} />
      </button>
      <TtlPicker value={ttl} onChange={setTtl} />

      <div className="input-wrapper">
        <textarea
          ref={textareaRef}
          id="msg-input"
          rows={1}
          placeholder={t('input.placeholder')}
          value={text}
          onChange={e => { setText(e.target.value); autoResize() }}
          onKeyDown={handleKeyDown}
          aria-label={t('input.placeholder')}
        />
        <button className="emoji-btn" onClick={e => { e.stopPropagation(); setEmojiOpen(!emojiOpen) }} aria-label="Emoji">
          😊
        </button>
      </div>

      <button className="send-btn" onClick={handleSend} disabled={sending} aria-label="Send">
        {sending ? <Loader size={16} className="spin-icon" /> : <Send size={16} />}
      </button>

      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImage} />
    </div>
  )
}
