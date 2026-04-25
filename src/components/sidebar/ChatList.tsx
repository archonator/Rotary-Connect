import { useState, useRef, useEffect } from 'react'
import { MoreHorizontal, Pencil, Trash2, MessageCirclePlus, Users } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { useT } from '../../hooks/useT'
import { Avatar } from '../ui/Avatar'
import { lastMsgPreview } from '../../lib/utils'
import { ConfirmDialog } from '../ui/ConfirmDialog'

export function ChatList() {
  const contacts = useStore(s => s.contacts)
  const rooms = useStore(s => s.rooms)
  const messages = useStore(s => s.messages)
  const unread = useStore(s => s.unread)
  const activeChat = useStore(s => s.activeChat)
  const setActiveChat = useStore(s => s.setActiveChat)
  const setSidebarOpen = useStore(s => s.setSidebarOpen)
  const renameContact = useStore(s => s.renameContact)
  const deleteContact = useStore(s => s.deleteContact)
  const setOpenModal = useStore(s => s.setOpenModal)
  const lang = useStore(s => s.lang)
  const t = useT()

  const [menuKey, setMenuKey] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ pubkey: string; name: string } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const contactItems = Object.values(contacts)
  const roomItems = Object.values(rooms)
  const hasAnything = contactItems.length > 0 || roomItems.length > 0

  useEffect(() => {
    if (!menuKey) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuKey(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuKey])

  useEffect(() => { if (renaming) renameInputRef.current?.focus() }, [renaming])

  const openDM = (pubkey: string, name: string) => {
    if (menuKey || renaming) return
    setActiveChat({ type: 'dm', id: pubkey, name, chatId: 'dm:' + pubkey })
    setSidebarOpen(false)
  }

  const openRoom = (hash: string, name: string) => {
    setActiveChat({ type: 'room', id: hash, name, chatId: 'room:' + hash })
    setSidebarOpen(false)
  }

  const startRename = (key: string, currentName: string) => {
    setMenuKey(null)
    setRenaming(key)
    setRenameValue(currentName)
  }

  const commitRename = (pubkey: string) => {
    const trimmed = renameValue.trim()
    if (trimmed) renameContact(pubkey, trimmed)
    setRenaming(null)
  }

  const handleDelete = (pubkey: string, name: string) => {
    setMenuKey(null)
    setDeleteTarget({ pubkey, name })
  }

  const confirmDelete = () => {
    if (deleteTarget) deleteContact(deleteTarget.pubkey)
    setDeleteTarget(null)
  }

  if (!hasAnything) {
    return (
      <div className="chat-list-empty">
        <div className="chat-list-empty-icon"><MessageCirclePlus size={32} strokeWidth={1.2} /></div>
        <div className="chat-list-empty-title">{t('list.empty')}</div>
        <div className="chat-list-empty-sub">{t('list.emptySub')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '1.2rem', width: '100%' }}>
          <button className="sidebar-action-btn primary" onClick={() => setOpenModal('add-contact')}>
            <MessageCirclePlus size={16} /> {t('list.inviteBtn')}
          </button>
          <button className="sidebar-action-btn" onClick={() => setOpenModal('add-room')}>
            <Users size={16} /> {t('list.groupBtn')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      {contactItems.map(c => {
        const chatId = 'dm:' + c.pubkey
        const isActive = activeChat?.chatId === chatId
        const isRenaming = renaming === c.pubkey
        const isMenuOpen = menuKey === c.pubkey

        return (
          <div
            key={c.pubkey}
            className={`chat-item${isActive ? ' active' : ''}`}
            onClick={() => openDM(c.pubkey, c.name)}
            style={{ position: 'relative' }}
          >
            <Avatar name={c.name} />
            <div className="contact-info">
              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(c.pubkey); if (e.key === 'Escape') setRenaming(null) }}
                  onBlur={() => commitRename(c.pubkey)}
                  onClick={e => e.stopPropagation()}
                  maxLength={30}
                  style={{ background: 'var(--surface2)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--text)', padding: '0.1rem 0.35rem', fontSize: '0.88rem', width: '100%', outline: 'none' }}
                />
              ) : (
                <div className="contact-name">{c.name}</div>
              )}
              <div className="contact-sub">{lastMsgPreview(messages[chatId] || [], lang)}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}>
              {(unread[chatId] || 0) > 0 && <div className="unread-badge">{unread[chatId]}</div>}
              <button
                className="chat-item-menu-btn"
                onClick={e => { e.stopPropagation(); setMenuKey(isMenuOpen ? null : c.pubkey) }}
                title={t('list.options')}
              >
                <MoreHorizontal size={16} />
              </button>
            </div>
            {isMenuOpen && (
              <div ref={menuRef} className="chat-item-menu" onClick={e => e.stopPropagation()}>
                <button onClick={() => startRename(c.pubkey, c.name)}>
                  <Pencil size={14} /> {t('list.rename')}
                </button>
                <button style={{ color: 'var(--danger)' }} onClick={() => handleDelete(c.pubkey, c.name)}>
                  <Trash2 size={14} /> {t('list.delete')}
                </button>
              </div>
            )}
          </div>
        )
      })}

      {roomItems.length > 0 && (
        <>
          {contactItems.length > 0 && <div className="chat-section-label">{t('list.groups')}</div>}
          {roomItems.map(r => {
            const chatId = 'room:' + r.hash
            const isActive = activeChat?.chatId === chatId
            return (
              <div key={r.hash} className={`chat-item${isActive ? ' active' : ''}`} onClick={() => openRoom(r.hash, r.name)}>
                <Avatar name={r.name} isGroup />
                <div className="contact-info">
                  <div className="contact-name">{r.name}</div>
                  <div className="contact-sub">{lastMsgPreview(messages[chatId] || [], lang)}</div>
                </div>
                {(unread[chatId] || 0) > 0 && <div className="unread-badge">{unread[chatId]}</div>}
              </div>
            )
          })}
        </>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={t('list.delete')}
          message={t('list.deleteConfirm', { name: deleteTarget.name })}
          confirmLabel={t('list.delete')}
          cancelLabel={t('contact.cancelBtn')}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
          danger
        />
      )}
    </>
  )
}
