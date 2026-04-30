/**
 * React-Eintrittspunkt.
 *
 * Hier passiert nicht viel — wir definieren genau zwei Routen:
 *   • "/"     → öffentliche Landing Page (Marketing, Info)
 *   • "/app"  → die eigentliche Messenger-App
 *
 * Vor dem Rendern initialisieren wir den globalen Error-Logger, damit
 * unerwartete Fehler beim Boot bereits eingefangen und im In-App-Log
 * landen.
 *
 * Der Import von "@khmyznikov/pwa-install" registriert das
 * <pwa-install>-Custom-Element, das aus index.html angesprochen wird.
 */

import '@khmyznikov/pwa-install'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { App } from './App'
import { LandingPage } from './components/landing/LandingPage'
import { initLogger } from './lib/logger'
import './styles/index.css'

// Globalen Error-Logger einhängen (idempotent — siehe lib/logger.ts).
initLogger()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/app" element={<App />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
