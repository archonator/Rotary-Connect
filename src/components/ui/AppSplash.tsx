/**
 * AppSplash — Einblendung beim App-Start.
 *
 * Zeigt das Logo-Animations-Element und den App-Namen für ca. 2.8 s,
 * bevor `onDone` aufgerufen wird. Anschließend entscheidet App.tsx,
 * welche Phase als Nächstes kommt (Vault-Unlock, Setup, oder Ready).
 *
 * Die Animation ist als CSS-only via `<style>` inline definiert,
 * damit sie ohne externes Stylesheet läuft (relevant für die
 * allererste Render-Pause).
 */

import { useState, useEffect } from 'react'

export function AppSplash({ onDone }: { onDone: () => void }) {
  const [fadeOut, setFadeOut] = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => setFadeOut(true), 2800)
    const t2 = setTimeout(onDone, 3300)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [onDone])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: '#0e0e0f',
        opacity: fadeOut ? 0 : 1,
        transition: 'opacity 0.5s ease',
      }}
    >
      <style>{`
        .splash-loader {
          display: block;
          width: 84px;
          height: 84px;
          position: relative;
        }
        .splash-loader:before,
        .splash-loader:after {
          content: "";
          position: absolute;
          left: 50%;
          bottom: 0;
          width: 64px;
          height: 64px;
          border-radius: 50%;
          background: #F7A81B;
          transform: translate(-50%, -100%) scale(0);
          animation: splashPush 2s infinite linear;
        }
        .splash-loader:after {
          background: #B38463;
          animation-delay: 1s;
        }
        @keyframes splashPush {
          0%, 50% {
            transform: translate(-50%, 0%) scale(1);
          }
          100% {
            transform: translate(-50%, -100%) scale(0);
          }
        }
        .splash-text {
          opacity: 0;
          animation: splashFadeIn 0.6s ease-out 0.3s forwards;
        }
        @keyframes splashFadeIn {
          to { opacity: 1; }
        }
      `}</style>

      <div className="splash-loader" />
      <div className="splash-text" style={{
        marginTop: '2.5rem', fontFamily: "'Jost', sans-serif",
        fontSize: '2rem', fontWeight: 200,
        color: '#F7A81B', letterSpacing: '0.1em',
      }}>
        Rotary Connect
      </div>
    </div>
  )
}
