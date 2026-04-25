import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '../../store/useStore'
import { useT } from '../../hooks/useT'
import { MessageBubble } from './MessageBubble'
import { publishDM, publishRoomMessage } from '../../lib/nostr'
import type { Message } from '../../store/useStore'

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

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [chatMessages.length])

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
