import { useState, useRef, useEffect } from 'react'
import { ArrowLeft, Copy, Lock, Search, X, Wifi, Radio } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { useT } from '../../hooks/useT'
import { Avatar } from '../ui/Avatar'
import { encodeNpub } from '../../lib/crypto'

/**
 * ChatHeader — die Kopfzeile über dem aktiven Chat.
 *
 * Zeigt:
 *   • Avatar + Anzeigename des Gegenübers (oder Gruppenname)
 *   • Untertitel: "Verschlüsselt" bzw. "Gruppe", plus
 *     P2P-Indikator ("Direktverbindung"), wenn der Datenkanal offen ist
 *   • Such-Button: blendet eine kleine Suchleiste ein, die im offenen
 *     Chat nach Textnachrichten filtert
 *   • Kopier-Button: legt den eigenen npub in die Zwischenablage,
 *     sodass der User ihn schnell teilen kann
 *
 * Auf Mobile zusätzlich ein Pfeil-zurück-Button, der die Sidebar
 * wieder öffnet (zurück zur Chat-Übersicht).
 */
export function ChatHeader() {
  const activeChat = useStore(s => s.activeChat)
  const identity = useStore(s => s.identity)
  const contacts = useStore(s => s.contacts)
  const messages = useStore(s => s.messages)
  const showStatus = useStore(s => s.showStatus)
  const setSidebarOpen = useStore(s => s.setSidebarOpen)
  const peerStates = useStore(s => s.peerStates)
  const t = useT()

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  // Close search when switching chats
  useEffect(() => {
    setSearchOpen(false)
    setSearchQuery('')
  }, [activeChat?.chatId])

  if (!activeChat) return null

  const isGroup = activeChat.type === 'room'
  const isDM = activeChat.type === 'dm'
  const peerState = isDM ? peerStates[activeChat.id] : undefined
  const isP2P = peerState === 'connected'
  const contactName = !isGroup ? contacts[activeChat.id]?.name : undefined
  const displayName = contactName ?? activeChat.name

  const copyPubkey = () => {
    if (!identity?.pubkey) return
    navigator.clipboard.writeText(encodeNpub(identity.pubkey))
      .then(() => showStatus(t('header.pubkeyCopied'), 2000))
      .catch(() => {})
  }

  const chatMsgs = messages[activeChat.chatId] || []
  const searchResults = searchQuery.trim()
    ? chatMsgs.filter(m => m.type === 'text' && m.content.toLowerCase().includes(searchQuery.toLowerCase()))
    : []

  return (
    <>
      <div className="chat-header">
        <button className="btn icon-btn mobile-back" onClick={() => setSidebarOpen(true)} title={t('header.back')} aria-label={t('header.back')}>
          <ArrowLeft size={18} />
        </button>
        <Avatar name={displayName} isGroup={isGroup} />
        <div className="chat-header-info">
          <div className="chat-header-name">{displayName}</div>
          <div className="chat-header-sub" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            {!isGroup && <Lock size={11} />}
            {isGroup ? t('header.groupSubtitle') : t('header.encrypted')}
            {isDM && isP2P && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', color: '#27ae60', fontSize: '0.68rem', marginLeft: '0.3rem' }} title="Direct P2P connection — no relay">
                <Radio size={10} /> P2P
              </span>
            )}
            {isDM && peerState === 'connecting' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', color: 'var(--accent)', fontSize: '0.68rem', marginLeft: '0.3rem' }} title="Connecting P2P...">
                <Wifi size={10} /> ...
              </span>
            )}
          </div>
        </div>
        <button className="btn icon-btn" onClick={() => setSearchOpen(o => !o)} title={t('search.placeholder')} aria-label={t('search.placeholder')}>
          <Search size={16} />
        </button>
        <button className="btn icon-btn" onClick={copyPubkey} title={t('header.copyPubkey')} aria-label={t('header.copyPubkey')}>
          <Copy size={16} />
        </button>
      </div>
      {searchOpen && (
        <div className="chat-search-bar">
          <input
            ref={searchInputRef}
            className="chat-search-input"
            type="text"
            placeholder={t('search.placeholder')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery('') } }}
            aria-label={t('search.placeholder')}
          />
          {searchQuery && (
            <span className="search-count">
              {searchResults.length > 0
                ? `${searchResults.length} ${searchResults.length === 1 ? 'result' : 'results'}`
                : t('search.noResults')
              }
            </span>
          )}
          <button className="btn icon-btn" onClick={() => { setSearchOpen(false); setSearchQuery('') }} aria-label="Close search">
            <X size={16} />
          </button>
        </div>
      )}
    </>
  )
}
