/**
 * useT — i18n-Hook für React-Komponenten.
 *
 * Liefert eine `t(key, params?)`-Funktion zurück, die abhängig von der
 * aktuellen Sprache (aus dem Store) den passenden Übersetzungsstring
 * findet und Platzhalter wie `{name}` ersetzt.
 *
 * Da `lang` aus Zustand kommt, re-rendert jede Komponente, die `useT`
 * benutzt, automatisch beim Sprachwechsel.
 *
 * Beispiel:
 *   const t = useT()
 *   t('sidebar.relays', { n: '3', total: '7' })
 *   // → "3 von 7 Relays" (de) oder "3 of 7 relays" (en)
 */

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
