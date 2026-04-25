import { useState } from 'react'
import { Copy, Check, Users } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { useT } from '../../hooks/useT'
import { hashRoomName } from '../../lib/crypto'
import { subscribeToRoom, publishRoomPresence } from '../../lib/nostr'

type View = 'create' | 'share'

export function AddRoomModal() {
  const setOpenModal = useStore(s => s.setOpenModal)
  const addRoom = useStore(s => s.addRoom)
  const identity = useStore(s => s.identity)
  const setActiveChat = useStore(s => s.setActiveChat)
  const showStatus = useStore(s => s.showStatus)
  const t = useT()

  const [view, setView] = useState<View>('create')
  const [roomName, setRoomName] = useState('')
  const [copied, setCopied] = useState(false)

  const close = () => setOpenModal(null)

  const handleCreate = async () => {
    const name = roomName.trim()
    if (!name) return
    const hash = await hashRoomName(name)
    addRoom(hash, name)
    subscribeToRoom(hash)
    // Announce presence so other members discover us
    if (identity) {
      publishRoomPresence(identity.privkey, identity.pubkey, hash, identity.name)
    }
    setActiveChat({ type: 'room', id: hash, name, chatId: 'room:' + hash })
    setView('share')
  }

  const copyName = () => {
    navigator.clipboard.writeText(roomName.trim()).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDone = () => {
    showStatus(t('room.created', { name: roomName.trim() }), 2000)
    close()
  }

  if (view === 'share') {
    return (
      <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && close()}>
        <div className="modal">
          <div className="modal-title">{t('room.inviteTitle')}</div>
          <div className="modal-subtitle">{t('room.inviteSubtitle')}</div>

          <div
            onClick={copyName}
            title={t('contact.tapToCopy')}
            style={{
              textAlign: 'center', cursor: 'pointer',
              background: 'var(--surface2)', border: '2px solid var(--accent)',
              borderRadius: 12, padding: '1.2rem 1rem',
            }}
          >
            <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {t('room.groupNameLabel')}
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--accent)', marginBottom: '0.5rem' }}>
              {roomName.trim()}
            </div>
            <div style={{ fontSize: '0.75rem', color: copied ? 'var(--accent)' : 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
              {copied ? <><Check size={13} /> {t('contact.copied')}</> : <><Copy size={13} /> {t('contact.tapToCopy')}</>}
            </div>
          </div>

          <div style={{ fontSize: '0.82rem', color: 'var(--muted)', lineHeight: 1.6, background: 'var(--surface2)', borderRadius: 8, padding: '0.7rem 0.9rem' }}>
            {t('room.joinInstruction', { btn: t('sidebar.group') })}
          </div>

          <button className="btn" style={{ width: '100%' }} onClick={handleDone}>
            <Users size={16} style={{ marginRight: '0.4rem' }} />
            {t('room.done')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && close()}>
      <div className="modal">
        <div className="modal-title">{t('room.createTitle')}</div>
        <div className="modal-subtitle">{t('room.createSubtitle')}</div>

        <div>
          <div className="setup-label">{t('room.groupNameLabel')}</div>
          <input
            type="text"
            placeholder={t('room.namePlaceholder')}
            maxLength={50}
            value={roomName}
            onChange={e => setRoomName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && roomName.trim() && handleCreate()}
            autoFocus
          />
          <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '0.5rem', lineHeight: 1.5 }}>
            {t('room.nameTip')}
          </div>
        </div>

        <button
          className="btn"
          style={{ width: '100%' }}
          onClick={handleCreate}
          disabled={!roomName.trim()}
        >
          {t('room.createBtn')}
        </button>

        <button className="btn secondary" style={{ width: '100%' }} onClick={close}>
          {t('room.cancelBtn')}
        </button>
      </div>
    </div>
  )
}
