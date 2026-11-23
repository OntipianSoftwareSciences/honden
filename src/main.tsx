import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { applyTheme, readStoredTheme } from './hooks/useSettings'
import './index.css'

applyTheme(readStoredTheme())

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
