import { useStore } from '../../store/useStore'

export function LanguageToggle() {
  const lang = useStore(s => s.lang)
  const setLang = useStore(s => s.setLang)

  return (
    <div className="lang-toggle">
      <span className={`lang-toggle-label${lang === 'en' ? ' active' : ''}`}>EN</span>
      <label className="switch">
        <input
          type="checkbox"
          checked={lang === 'de'}
          onChange={() => setLang(lang === 'en' ? 'de' : 'en')}
        />
        <span className="slider" />
      </label>
      <span className={`lang-toggle-label${lang === 'de' ? ' active' : ''}`}>DE</span>
    </div>
  )
}
