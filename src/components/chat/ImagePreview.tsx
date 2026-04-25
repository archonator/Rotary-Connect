import { useState, useEffect, useCallback } from 'react'
import { X, Send, Shield } from 'lucide-react'
import { useT } from '../../hooks/useT'
import { MAX_IMAGE_SIZE } from '../../lib/constants'

interface ImagePreviewProps {
  file: File
  onSend: (dataUrl: string) => void
  onCancel: () => void
}

const TARGET_SIZE = MAX_IMAGE_SIZE // use centralized constant for max base64 output size
const MAX_DIMENSION = 800  // max width/height in pixels

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      let { width, height } = img

      // Scale down if needed
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }

      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)

      // Try decreasing quality until under target size
      let quality = 0.7
      let result = canvas.toDataURL('image/jpeg', quality)

      while (result.length > TARGET_SIZE && quality > 0.1) {
        quality -= 0.05
        result = canvas.toDataURL('image/jpeg', quality)
      }

      // If still too large, scale down further
      if (result.length > TARGET_SIZE) {
        const scale = Math.sqrt(TARGET_SIZE / result.length)
        canvas.width = Math.round(width * scale)
        canvas.height = Math.round(height * scale)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        result = canvas.toDataURL('image/jpeg', 0.6)
      }

      resolve(result)
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = URL.createObjectURL(file)
  })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

export function ImagePreview({ file, onSend, onCancel }: ImagePreviewProps) {
  const t = useT()
  const [preview, setPreview] = useState<string | null>(null)
  const [compressed, setCompressed] = useState<string | null>(null)
  const [compressing, setCompressing] = useState(true)

  useEffect(() => {
    // Show original as preview immediately
    const url = URL.createObjectURL(file)
    setPreview(url)

    // Compress in background
    setCompressing(true)
    compressImage(file).then(result => {
      setCompressed(result)
      setCompressing(false)
    }).catch(() => {
      setCompressing(false)
    })

    return () => URL.revokeObjectURL(url)
  }, [file])

  const handleSend = useCallback(() => {
    if (compressed) onSend(compressed)
  }, [compressed, onSend])

  const originalSize = file.size
  const compressedSize = compressed ? Math.round((compressed.length * 3) / 4) : 0 // base64 → bytes approx
  const reduction = originalSize > 0 && compressedSize > 0
    ? Math.round((1 - compressedSize / originalSize) * 100)
    : 0

  return (
    <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ maxWidth: 360, padding: 0, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.7rem 0.9rem', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{t('image.title')}</span>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '0.2rem' }}>
            <X size={18} />
          </button>
        </div>

        {/* Image preview */}
        <div style={{ background: '#000', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 180, maxHeight: 300, overflow: 'hidden' }}>
          {preview && (
            <img src={preview} alt="" style={{ maxWidth: '100%', maxHeight: 300, objectFit: 'contain' }} />
          )}
        </div>

        {/* Info section */}
        <div style={{ padding: '0.8rem 0.9rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {/* Encryption notice */}
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
            background: 'var(--surface2)', borderRadius: 8, padding: '0.6rem 0.7rem',
            fontSize: '0.78rem', color: 'var(--muted)', lineHeight: 1.5,
          }}>
            <Shield size={16} style={{ flexShrink: 0, marginTop: 1, color: 'var(--accent)' }} />
            <span>{t('image.encryptionNotice')}</span>
          </div>

          {/* Compression info */}
          {compressing ? (
            <div style={{ textAlign: 'center', fontSize: '0.82rem', color: 'var(--muted)', padding: '0.3rem 0' }}>
              {t('image.compressing')}
            </div>
          ) : compressed ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--muted)' }}>
              <span>{formatSize(originalSize)} → {formatSize(compressedSize)}</span>
              {reduction > 0 && <span style={{ color: 'var(--accent)' }}>−{reduction}%</span>}
            </div>
          ) : (
            <div style={{ textAlign: 'center', fontSize: '0.82rem', color: '#e07070' }}>
              {t('image.compressionFailed')}
            </div>
          )}

          {/* Send button */}
          <button
            className="btn"
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
            onClick={handleSend}
            disabled={compressing || !compressed}
          >
            <Send size={15} />
            {t('image.send')}
          </button>
        </div>
      </div>
    </div>
  )
}
