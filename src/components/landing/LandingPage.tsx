import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../../hooks/useT'
import { SOURCE_PREVIEW } from './sourcePreview'
import { LanguageToggle } from '../ui/LanguageToggle'

/**
 * LandingPage — die öffentliche "Über"-Seite unter "/".
 *
 * Reines Marketing/Information: erklärt, was Rotary Connect ist,
 * stellt vier Kernversprechen vor, listet Features und gibt eine
 * Quick-Start-Anleitung. Kein Identitätszustand, kein Vault — diese
 * Seite kann auch ohne Login angesehen werden.
 *
 * Ein Klick auf "App öffnen" navigiert zu "/app", wo das eigentliche
 * Vault-/Setup-Routing aus App.tsx übernimmt.
 */
export function LandingPage() {
  const [copied, setCopied] = useState(false)
  const t = useT()

  const copySource = () => {
    navigator.clipboard.writeText(SOURCE_PREVIEW).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div className="landing-page">
      {/* NAV */}
      <nav>
        <Link to="/" className="nav-logo">
          <img src="/logo.svg?v=3" alt="Rotary Connect" />
        </Link>
        <div className="nav-right">
          <a href="#howto" className="nav-link">{t('landing.guide')}</a>
          <a href="#source" className="nav-link">{t('landing.sourceCode')}</a>
          <LanguageToggle />
          <Link to="/app" className="nav-cta">{t('landing.openApp')}</Link>
        </div>
      </nav>
      {/* HERO — Entwurf 1: Inline Brand */}
      <section className="hero-1">
        <div className="hero-brand">
          <span className="hero-brand-name">Rotary Connect</span>
          <div className="hero-brand-line" />
          <span className="hero-brand-tagline">{t('landing.heroBrandTagline')}</span>
        </div>
        <h1 className="hero-title">
          {t('landing.heroTitle1')}<br /><em>{t('landing.heroTitle2')}</em>
        </h1>
        <p className="hero-sub">{t('landing.heroSub')}</p>
        <Link to="/app" className="hero-cta-btn">{t('landing.openApp')}</Link>
        <p className="hero-hint">{t('landing.pwaHint')}</p>
      </section>
      {/* PROMISES */}
      <section className="promises" id="promises">
        <div className="container">
          <div className="section-eyebrow">{t('landing.promisesEyebrow')}</div>
          <h2 className="section-title">{t('landing.promisesTitle')} <em>{t('landing.promisesTitleEm')}</em></h2>
          <div className="promise-grid">
            <div className="promise">
              <div className="promise-num">01</div>
              <div className="promise-title">{t('landing.promise1Title')}</div>
              <div className="promise-body">{t('landing.promise1Body')}</div>
            </div>
            <div className="promise">
              <div className="promise-num">02</div>
              <div className="promise-title">{t('landing.promise2Title')}</div>
              <div className="promise-body">{t('landing.promise2Body')}</div>
            </div>
            <div className="promise">
              <div className="promise-num">03</div>
              <div className="promise-title">{t('landing.promise3Title')}</div>
              <div className="promise-body">{t('landing.promise3Body')}</div>
            </div>
            <div className="promise">
              <div className="promise-num">04</div>
              <div className="promise-title">{t('landing.promise4Title')}</div>
              <div className="promise-body">{t('landing.promise4Body')}</div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features">
        <div className="container">
          <div className="section-eyebrow">{t('landing.featuresEyebrow')}</div>
          <h2 className="section-title">
            {t('landing.featuresTitle1')}<br /><em>{t('landing.featuresTitle2')}</em>
          </h2>
          <div className="features-grid">
            <div className="feature">
              <span className="feature-icon">💬</span>
              <div className="feature-name">{t('landing.featureTextName')}</div>
              <div className="feature-desc">{t('landing.featureTextDesc')}</div>
            </div>
            <div className="feature">
              <span className="feature-icon">🖼</span>
              <div className="feature-name">{t('landing.featureImageName')}</div>
              <div className="feature-desc">{t('landing.featureImageDesc')}</div>
            </div>            <div className="feature">
              <span className="feature-icon">📍</span>
              <div className="feature-name">{t('landing.featureLocationName')}</div>
              <div className="feature-desc">{t('landing.featureLocationDesc')}</div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW TO */}
      <section className="howto" id="howto">
        <div className="container">
          <div className="section-eyebrow">{t('landing.howtoEyebrow')}</div>
          <h2 className="section-title">
            {t('landing.howtoTitle1')} <em>{t('landing.howtoTitle2')}</em>
          </h2>
          <div className="steps">
            <div className="step">
              <div className="step-num">1</div>
              <div className="step-body">
                <div className="step-title">{t('landing.step1Title')}</div>
                <div className="step-desc">{t('landing.step1Desc')}</div>
              </div>
            </div>            <div className="step">
              <div className="step-num">2</div>
              <div className="step-body">
                <div className="step-title">{t('landing.step2Title')}</div>
                <div className="step-desc">{t('landing.step2Desc')}</div>
              </div>
            </div>
            <div className="step">
              <div className="step-num">3</div>
              <div className="step-body">
                <div className="step-title">{t('landing.step3Title')}</div>
                <div className="step-desc">{t('landing.step3Desc')}</div>
              </div>
            </div>
            <div className="step">
              <div className="step-num">4</div>
              <div className="step-body">
                <div className="step-title">{t('landing.step4Title')}</div>
                <div className="step-desc">{t('landing.step4Desc')}</div>
              </div>
            </div>
            <div className="step">
              <div className="step-num">5</div>
              <div className="step-body">                <div className="step-title">{t('landing.step5Title')}</div>
                <div className="step-desc">{t('landing.step5Desc')}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SOURCE */}
      <section id="source">
        <div className="container">
          <div className="section-eyebrow">{t('landing.sourceEyebrow')}</div>
          <h2 className="section-title">{t('landing.sourceTitle')} <em>{t('landing.sourceTitleEm')}</em></h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '2rem', lineHeight: 1.8, maxWidth: 520 }}>
            {t('landing.sourceDesc')}
          </p>
          <div className="source-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                {t('landing.sourceLicense')}
              </span>
              <button className={`copy-btn${copied ? ' copied' : ''}`} onClick={copySource}>
                {copied ? t('landing.sourceCopied') : t('landing.sourceCopy')}
              </button>
            </div>          </div>
          <div className="source-box">
            <div className="source-toolbar">
              <span className="source-filename">src/lib/nostr.ts</span>
              <span className="source-stats">React + TypeScript · Nostr · NIP-04</span>
            </div>
            <pre className="source-pre">{SOURCE_PREVIEW}</pre>
          </div>
        </div>
      </section>

      {/* PHILOSOPHY */}
      <section style={{ borderTop: '1px solid var(--rule)' }}>
        <div className="container">
          <div className="philosophy-inner">
            <div className="section-eyebrow">{t('landing.philEyebrow')}</div>
            <blockquote>
              {t('landing.philQuote')}
            </blockquote>
            <p className="quote-caption">{t('landing.philCaption')}</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted)', lineHeight: 1.9, marginTop: '1.8rem', paddingLeft: '2rem', maxWidth: 480 }}>
              {t('landing.philBody')}
            </p>
          </div>
        </div>      </section>

      {/* FOOTER */}
      <footer>
        <div className="footer-left">
          <img src="/logo.svg?v=3" alt="Rotary Connect" className="footer-logo" />
          <span className="footer-text">{t('landing.footerText')}</span>
        </div>

        <div className="social-icons">
          <a href="https://github.com/Leon-Muehlenbruch/RotaryConnect" className="icon github" target="_blank" rel="noopener noreferrer">
            <span className="tooltip">GitHub</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
          </a>
        </div>

        <span className="footer-mit">{t('landing.footerLicense')}</span>
      </footer>
    </div>
  )
}
