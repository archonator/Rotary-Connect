import { saveLog } from './storage'

export function initLogger(): void {
  const _error = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    _error(...args)
    saveLog('error', args.map(a => String(a)).join(' '))
  }

  const _warn = console.warn.bind(console)
  console.warn = (...args: unknown[]) => {
    _warn(...args)
    saveLog('warn', args.map(a => String(a)).join(' '))
  }

  window.onerror = (msg, src, line, col, err) => {
    saveLog('onerror', `${msg} @ ${src}:${line}:${col}${err ? ' — ' + err.stack : ''}`)
  }

  window.onunhandledrejection = (e: PromiseRejectionEvent) => {
    saveLog('promise', String(e.reason))
  }
}
