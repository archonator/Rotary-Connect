import { translations, type Lang } from './i18n'

function tr(lang: Lang, key: 'utils.yesterday' | 'utils.noMessages' | 'utils.image' | 'utils.location'): string {
  return translations[lang][key] as string
}

export function formatTime(ts: number, lang: Lang = 'en'): string {
  const d = new Date(ts)
  const now = new Date()
  const locale = lang === 'de' ? 'de-DE' : 'en-GB'
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

  if (sameDay) return time

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `${tr(lang, 'utils.yesterday')} ${time}`

  const sameYear = d.getFullYear() === now.getFullYear()
  const date = sameYear
    ? d.toLocaleDateString(locale, { day: '2-digit', month: 'short' })
    : d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })

  return `${date}, ${time}`
}

export function lastMsgPreview(messages: { type: string; content: string }[], lang: Lang = 'en'): string {
  const last = messages[messages.length - 1]
  if (!last) return tr(lang, 'utils.noMessages')
  if (last.type === 'image') return tr(lang, 'utils.image')
  if (last.type === 'location') return tr(lang, 'utils.location')
  return last.content ? last.content.slice(0, 40) : ''
}
