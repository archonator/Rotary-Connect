export interface TranslationResult {
  text: string
  from: string
}

// Human-readable language names for UI display
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

// djb2 hash for cache keys — fast, no crypto needed
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

async function detectLang(text: string): Promise<string> {
  // Chrome AI Language Detector (Chrome 127+, offline)
  try {
    const ai = (window as any).ai
    if (ai?.languageDetector) {
      const caps = await ai.languageDetector.capabilities()
      if (caps.available !== 'no') {
        const detector = await ai.languageDetector.create()
        const results = await detector.detect(text)
        if (results?.[0]?.detectedLanguage) return results[0].detectedLanguage.split('-')[0]
      }
    }
  } catch { /* fall through */ }

  // Script heuristics as fallback
  if (/[\u0400-\u04FF]/.test(text)) return /[іїєґ]/.test(text) ? 'uk' : 'ru'
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh'
  if (/[\u3040-\u30FF]/.test(text)) return 'ja'
  if (/[\uAC00-\uD7AF]/.test(text)) return 'ko'
  if (/[\u0600-\u06FF]/.test(text)) return 'ar'
  return 'en'
}

// ── Translation providers ─────────────────────────────────────────────────────

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

export async function translate(text: string, targetLang: string, allowExternal = true): Promise<TranslationResult> {
  if (!text.trim()) return { text, from: targetLang }

  const cached = cacheGet(text, targetLang)
  if (cached) return cached

  const from = await detectLang(text)
  const fromBase = from.split('-')[0]
  const toBase = targetLang.split('-')[0]

  if (fromBase === toBase) return { text, from: fromBase }

  // Try Chrome AI first (offline & private), then MyMemory only if allowed
  let translated = await translateChromeAI(text, fromBase, toBase)
  if (!translated && allowExternal) {
    translated = await translateMyMemory(text, fromBase, toBase)
  }

  if (!translated) return { text, from: fromBase }

  const result: TranslationResult = { text: translated, from: fromBase }
  cacheSet(text, targetLang, result)
  return result
}
