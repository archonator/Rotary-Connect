import { useStore } from '../../store/useStore'

export function StatusBar() {
  const statusMessage = useStore(s => s.statusMessage)

  if (!statusMessage) return null

  return (
    <div className="status-bar" style={{ display: 'block' }}>
      {statusMessage}
    </div>
  )
}
