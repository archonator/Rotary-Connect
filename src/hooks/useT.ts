import { useStore } from '../store/useStore'
import { translations, type TKey } from '../lib/i18n'

export function useT() {
  const lang = useStore(s => s.lang)
  return function t(key: TKey, params?: Record<string, string>): string {
    let str = translations[lang][key] as string
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v)
      }
    }
    return str
  }
}
