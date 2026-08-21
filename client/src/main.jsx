import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { installLogBuffer } from './utils/logBuffer'

// Start capturing logs before anything else runs, so a crash during startup
// is still in the buffer when the user taps "Send diagnostics".
installLogBuffer()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
