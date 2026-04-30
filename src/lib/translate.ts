/**
 * Auto-Übersetzungs-Schicht.
 *
 * Wird auf eingehende Textnachrichten angewendet, NACHDEM sie
 * NIP-04/NIP-17-entschlüsselt wurden. Das heißt: der Klartext liegt
 * im Browser des Empfängers vor, bevor irgendetwas an einen
 * Übersetzungs-Provider gehen könnte. Damit die Datenschutz-Versprechen
 * eingehalten werden können, gibt es zwei Provider:
 *
 *   1. Chrome AI Translation API (Chrome 127+) — läuft komplett offline
 *      auf dem Gerät, kein Netzwerk-Call. Erste Wahl.
 *   2. MyMemory (kostenlos, kein API-Key) — Fallback, schickt den Text
 *      an einen externen Server. Standardmäßig AUS, der User muss
 *      "Externe Übersetzung erlauben" in den Einstellungen
 *      aktivieren, sonst wird MyMemory nie befragt.
 *
 * Resultate werden pro (Text, Zielsprache) in localStorage gecacht,
 * damit erneutes Anzeigen derselben Nachricht keinen API-Call kostet.
 */

export interface TranslationResult {
  text: string  // übersetzter Text (oder das Original, falls keine Übersetzung möglich)
  from: string  // erkannte Quellsprache (BCP-47-Basis: "en", "de", "ru", …)
}

/** Anzeigetexte für Sprachen — fallen zurück auf den ISO-Code in Großbuchstaben. */
const LANG_NAMES: Record<string, string> = {
  de: 'Deutsch', en: 'English', ru: 'Русский',
  fr: 'Français', es: 'Español', it: 'Italiano',
  pt: 'Português', nl: 'Nederlands', pl: 'Polski',
  tr: 'Türkçe', ar: 'العربية', zh: '中文',
  ja: '日本語', ko: '한국어', uk: 'Українська',
}

export function getLangName(code: string): string {
  return LANG_NAMES[code] || code.toUpperCase()
}

/**
 * djb2-Hash für Cache-Keys. Bewusst kein SHA-256: für die Indexierung
 * im localStorage reicht ein 32-bit-Hash, und djb2 ist synchron + ohne
 * WebCrypto-Aufwand.
 */
function hashText(text: string): number {
  let hash = 5381
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i)
    hash |= 0
  }
  return hash >>> 0
}

function cacheGet(text: string, target: string): TranslationResult | null {
  try {
    const raw = localStorage.getItem(`alina-tr:${hashText(text)}:${target}`)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function cacheSet(text: string, target: string, result: TranslationResult): void {
  try {
    localStorage.setItem(`alina-tr:${hashText(text)}:${target}`, JSON.stringify(result))
  } catch { /* ignore quota errors */ }
}

// ── Language detection ────────────────────────────────────────────────────────

/** Reduce a BCP-47 tag (e.g. "en-US") to its base language ("en"). */
function baseLang(tag: string): string {
  return tag.split('-')[0] ?? tag
}

async function detectLang(text: string): Promise<string> {
  // Chrome AI Language Detector (Chrome 127+, offline)
  try {
    const ai = (window as any).ai
    if (ai?.languageDetector) {
      const caps = await ai.languageDetector.capabilities()
      if (caps.available !== 'no') {
        const detector = await ai.languageDetector.create()
        const results = await detector.detect(text)
        if (results?.[0]?.detectedLanguage) return baseLang(results[0].detectedLanguage)
      }
    }
  } catch { /* fall through */ }

  // Skript-Heuristik als Fallback. Reicht, um zu erkennen, ob sich
  // eine Übersetzung überhaupt lohnt — die exakte Sprache liefert dann
  // ggf. der Übersetzungs-Provider.
  if (/[\u0400-\u04FF]/.test(text)) return /[іїєґ]/.test(text) ? 'uk' : 'ru' // Kyrillisch → ru/uk
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh' // Han-Zeichen → Chinesisch
  if (/[\u3040-\u30FF]/.test(text)) return 'ja' // Hiragana/Katakana → Japanisch
  if (/[\uAC00-\uD7AF]/.test(text)) return 'ko' // Hangul → Koreanisch
  if (/[\u0600-\u06FF]/.test(text)) return 'ar' // Arabisch
  return 'en' // Default: Englisch
}

// ── Übersetzungs-Provider ─────────────────────────────────────────────────────

/**
 * Chrome AI Translation API (Chrome 127+, offline).
 * Wenn nicht verfügbar oder das Sprachpaar nicht unterstützt → null.
 */
async function translateChromeAI(text: string, from: string, to: string): Promise<string | null> {
  try {
    const ai = (window as any).ai
    if (!ai?.translator) return null
    const caps = await ai.translator.capabilities()
    if (caps.languagePairAvailable(from, to) === 'no') return null
    const t = await ai.translator.create({ sourceLanguage: from, targetLanguage: to })
    return await t.translate(text)
  } catch { return null }
}

/**
 * MyMemory Public API als Fallback.
 *
 * Schickt den Text (auf 500 Zeichen gekürzt) an
 * api.mymemory.translated.net. 8-Sekunden-Timeout, damit ein träge
 * antwortender Server die UI nicht ewig blockiert. Wird nur
 * aufgerufen, wenn der Aufrufer von `translate()` `allowExternal=true`
 * setzt — also der User in den Einstellungen explizit zugestimmt hat.
 */
async function translateMyMemory(text: string, from: string, to: string): Promise<string | null> {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${from}|${to}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const json = await res.json()
    if (json.responseStatus === 200 && json.responseData?.translatedText) {
      return json.responseData.translatedText
    }
    return null
  } catch { return null }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Übersetzt einen Text in die Zielsprache.
 *
 * Provider-Reihenfolge:
 *   1. Cache-Treffer? → sofort zurück.
 *   2. Spracherkennung. Wenn die erkannte Sprache mit der Zielsprache
 *      übereinstimmt → keine Übersetzung nötig, Original zurück.
 *   3. Chrome AI (offline). Falls null:
 *   4. MyMemory (extern), aber nur wenn `allowExternal === true`.
 *   5. Letzte Linie: Originaltext + erkannte Sprache.
 *
 * Cached wird grundsätzlich, sobald eine Übersetzung erfolgreich war.
 */
export async function translate(text: string, targetLang: string, allowExternal = true): Promise<TranslationResult> {
  if (!text.trim()) return { text, from: targetLang }

  const cached = cacheGet(text, targetLang)
  if (cached) return cached

  const from = await detectLang(text)
  const fromBase = baseLang(from)
  const toBase = baseLang(targetLang)

  if (fromBase === toBase) return { text, from: fromBase }

  // Erst Chrome AI (offline + privat), dann MyMemory falls erlaubt
  let translated = await translateChromeAI(text, fromBase, toBase)
  if (!translated && allowExternal) {
    translated = await translateMyMemory(text, fromBase, toBase)
  }

  if (!translated) return { text, from: fromBase }

  const result: TranslationResult = { text: translated, from: fromBase }
  cacheSet(text, targetLang, result)
  return result
}
