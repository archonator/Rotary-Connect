import { useState, useEffect } from 'react'
import { useStore } from '../../store/useStore'
import { useT } from '../../hooks/useT'
import { ChatList } from './ChatList'
import { RELAYS } from '../../lib/constants'
import { Settings, MessageCirclePlus, Users, Download } from 'lucide-react'

export function Sidebar() {
  const setOpenModal = useStore(s => s.setOpenModal)
  const sidebarOpen = useStore(s => s.sidebarOpen)
  const relayCount = useStore(s => s.relayCount)
  const total = RELAYS.length
  const t = useT()
  const [installAvailable, setInstallAvailable] = useState(false)

  useEffect(() => {
    const el = document.querySelector('pwa-install') as any
    if (!el) return
    if (el.isInstallAvailable) setInstallAvailable(true)
    const handler = () => setInstallAvailable(true)
    el.addEventListener('pwa-install-available-event', handler)
    return () => el.removeEventListener('pwa-install-available-event', handler)
  }, [])

  const handleInstall = () => {
    const el = document.querySelector('pwa-install') as any
    el?.showDialog(true)
  }

  const dotColor = relayCount === 0 ? '#e07070' : relayCount < total / 2 ? '#e0b870' : '#70c070'

  return (
    <div className={`sidebar${sidebarOpen ? ' open' : ''}`} id="sidebar">
      <div className="sidebar-header">
        <span
          title={t('sidebar.relays', { n: String(relayCount), total: String(total) })}
          aria-label={t('sidebar.relays', { n: String(relayCount), total: String(total) })}
          role="status"
          style={{
            display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
            background: dotColor,
            boxShadow: relayCount > 0 ? `0 0 4px ${dotColor}` : 'none',
          }}
        />
        <span className="sr-only">{t('sidebar.relays', { n: String(relayCount), total: String(total) })}</span>
        {installAvailable && (
          <button
            className="btn icon-btn"
            title={t('sidebar.install')}
            onClick={handleInstall}
          >
            <Download size={17} />
          </button>
        )}
        <button
          className="btn icon-btn"
          title={t('sidebar.settings')}
          aria-label={t('sidebar.settings')}
          onClick={() => setOpenModal('settings')}
        >
          <Settings size={17} />
        </button>
      </div>

      <div className="sidebar-list">
        <ChatList />
      </div>

      <div className="sidebar-footer">
        <button className="sidebar-action-btn primary" onClick={() => setOpenModal('add-contact')}>
          <MessageCirclePlus size={16} />
          {t('sidebar.newChat')}
        </button>
        <button className="sidebar-action-btn" onClick={() => setOpenModal('add-room')}>
          <Users size={16} />
          {t('sidebar.group')}
        </button>
      </div>
    </div>
  )
}
