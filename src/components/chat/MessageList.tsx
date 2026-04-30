import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '../../store/useStore'
import { useT } from '../../hooks/useT'
import { MessageBubble } from './MessageBubble'
import { publishDM, publishRoomMessage } from '../../lib/nostr'
import type { Message } from '../../store/useStore'

/**
 * MessageList — der scrollbare Block mit allen Nachrichten des
 * aktiven Chats.
 *
 * Wichtige Details:
 *   • Auto-Scroll-Heuristik: Wenn der User schon nahe am unteren
 *     Rand war (innerhalb 80 px), springt der Container bei einer
 *     neuen Nachricht nach unten. Andernfalls bleibt die Scroll-
 *     Position erhalten — wer alte Nachrichten liest, wird nicht
 *     ständig nach unten "geklaut".
 *   • Beim Wechsel des Chats wird immer auf Bottom gesnappt.
 *   • Retry-Logik: gescheiterte eigene Nachrichten haben einen
 *     Retry-Knopf in der Bubble; der Handler hier setzt den Status
 *     auf "sending", versucht erneut zu publishen, und schreibt
 *     entsprechend "sent" oder "failed" zurück.
 */

interface MessageListProps {
  onImageClick: (src: string) => void
}

export function MessageList({ onImageClick }: MessageListProps) {
  const activeChat = useStore(s => s.activeChat)
  const messages = useStore(s => s.messages)
  const identity = useStore(s => s.identity)
  const contacts = useStore(s => s.contacts)
  const updateMessageStatus = useStore(s => s.updateMessageStatus)
  const t = useT()
  const containerRef = useRef<HTMLDivElement>(null)

  const chatMessages = activeChat ? (messages[activeChat.chatId] || []) : []

  // Scroll to bottom only if the user was already near the bottom (preserves scroll
  // position when reading older messages and a new one comes in).
  const wasNearBottomRef = useRef(true)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    wasNearBottomRef.current = distanceFromBottom < 80
  })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (wasNearBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [chatMessages.length])

  // Always snap to bottom when switching chats
  useEffect(() => {
    const el = containerRef.current
    if (el) el.scrollTop = el.scrollHeight
    wasNearBottomRef.current = true
  }, [activeChat?.chatId])

  const handleRetry = useCallback(async (msg: Message) => {
    if (!activeChat || !identity) return
    updateMessageStatus(activeChat.chatId, msg.ts, msg.pubkey, 'sending')
    const msgData = { type: msg.type, content: msg.content, ...(msg.ttl ? { ttl: msg.ttl } : {}) }
    try {
      if (activeChat.type === 'dm') {
        await publishDM(identity.privkey, identity.pubkey, activeChat.id, msgData)
      } else {
        await publishRoomMessage(identity.privkey, identity.pubkey, activeChat.id, { ...msgData, name: identity.name })
      }
      updateMessageStatus(activeChat.chatId, msg.ts, msg.pubkey, 'sent')
    } catch {
      updateMessageStatus(activeChat.chatId, msg.ts, msg.pubkey, 'failed')
    }
  }, [activeChat, identity, updateMessageStatus])

  if (!activeChat) return null

  return (
    <div className="chat-messages" ref={containerRef} role="log" aria-label={t('msg.start')}>
      {chatMessages.length === 0 && (
        <div className="msg-system">{t('msg.start')}</div>
      )}
      {chatMessages.map((msg, i) => {
        const isMine = msg.pubkey === identity?.pubkey
        const senderName = !isMine && activeChat.type === 'room'
          ? (msg.name || contacts[msg.pubkey]?.name || msg.pubkey.slice(0, 8) + '...')
          : undefined

        return (
          <MessageBubble
            key={msg.eventId || `${msg.ts}-${msg.pubkey}-${i}`}
            msg={msg}
            isMine={isMine}
            isRoom={activeChat.type === 'room'}
            senderName={senderName}
            onImageClick={onImageClick}
            onRetry={handleRetry}
          />
        )
      })}
    </div>
  )
}
