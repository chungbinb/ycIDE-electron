import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'

window.addEventListener('error', (event) => {
  const stack = event.error?.stack || ''
  void window.api?.debug?.logRendererError({
    source: 'window.error',
    message: event.message || 'Unknown renderer error',
    stack,
    extra: {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    },
  })
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  const message = typeof reason === 'string'
    ? reason
    : (reason?.message || 'Unhandled promise rejection')
  const stack = reason?.stack || ''
  void window.api?.debug?.logRendererError({
    source: 'window.unhandledrejection',
    message,
    stack,
    extra: reason,
  })
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
