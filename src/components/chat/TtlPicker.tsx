import { useState } from 'react'
import { Timer, TimerOff } from 'lucide-react'
import { useT } from '../../hooks/useT'

export interface TtlOption {
  label: string
  seconds: number // 0 = off
}

interface TtlPickerProps {
  value: number // current TTL in seconds (0 = off)
  onChange: (seconds: number) => void
}

export function TtlPicker({ value, onChange }: TtlPickerProps) {
  const t = useT()
  const [open, setOpen] = useState(false)

  const options: TtlOption[] = [
    { label: t('ephemeral.off'), seconds: 0 },
    { label: t('ephemeral.seconds', { n: '30' }), seconds: 30 },
    { label: t('ephemeral.minutes', { n: '5' }), seconds: 300 },
    { label: t('ephemeral.minutes', { n: '30' }), seconds: 1800 },
    { label: t('ephemeral.hours', { n: '1' }), seconds: 3600 },
    { label: t('ephemeral.hours', { n: '24' }), seconds: 86400 },
  ]

  const activeLabel = options.find(o => o.seconds === value)?.label || t('ephemeral.off')
  const isActive = value > 0

  return (
    <div className="ttl-picker-wrapper">
      <button
        className={`ttl-btn${isActive ? ' active' : ''}`}
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        title={isActive ? t('ephemeral.active', { label: activeLabel }) : t('ephemeral.tooltip')}
      >
        {isActive ? <Timer size={17} /> : <TimerOff size={17} />}
        {isActive && <span className="ttl-badge">{activeLabel}</span>}
      </button>

      {open && (
        <div className="ttl-dropdown" onClick={(e) => e.stopPropagation()}>
          {options.map(opt => (
            <button
              key={opt.seconds}
              className={`ttl-option${opt.seconds === value ? ' selected' : ''}`}
              onClick={() => { onChange(opt.seconds); setOpen(false) }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
