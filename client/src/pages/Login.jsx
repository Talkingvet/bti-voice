import { useState } from 'react'
import { api } from '../api'
import { useTheme } from '../ThemeContext'
import { IS_TOUCH } from '../utils/touch'

export default function Login({ onLogin }) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { agent, token, default_password } = await api.login(username, password)
      onLogin(agent, token, default_password)
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const T = isDark ? {
    card:  { background: '#1d2330', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' },
    brand: { color: '#e8edf5' },
    sub:   { color: 'rgba(255,255,255,0.4)' },
    label: { color: 'rgba(255,255,255,0.55)' },
    input: { background: '#252d3c', border: '1.5px solid rgba(255,255,255,0.12)', color: '#e8edf5' },
    error: { background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)' },
  } : { card: {}, brand: {}, sub: {}, label: {}, input: {}, error: {} }

  return (
    <div style={styles.page}>
      <div style={{ ...styles.card, ...T.card }}>
        <div style={styles.logo}>📞</div>
        <h1 style={{ ...styles.brand, ...T.brand }}><span style={{ color: '#4f9cf9' }}>BTI</span> Voice</h1>
        <p style={{ ...styles.sub, ...T.sub }}>Shared SMS & Call Inbox</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={{ ...styles.label, ...T.label }}>Username</label>
            <input
              style={{ ...styles.input, ...T.input }}
              type="text"
              placeholder="e.g. shawn"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus={!IS_TOUCH}
              required
            />
          </div>
          <div style={styles.field}>
            <label style={{ ...styles.label, ...T.label }}>Password</label>
            <input
              style={{ ...styles.input, ...T.input }}
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <div style={{ ...styles.error, ...T.error }}>{error}</div>}
          <button style={styles.btn} type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100dvh', // dvh: shrinks with the iOS keyboard so the card stays visible
    background: 'linear-gradient(135deg, #1a2332 0%, #243447 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    background: 'white',
    borderRadius: 16,
    padding: '40px 36px',
    width: 360,
    boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
    textAlign: 'center',
  },
  logo: { fontSize: 40, marginBottom: 8 },
  brand: { fontSize: 28, fontWeight: 700, marginBottom: 4 },
  sub: { color: '#888', fontSize: 13, marginBottom: 28 },
  form: { textAlign: 'left' },
  field: { marginBottom: 16 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' },
  input: {
    width: '100%', padding: '10px 14px',
    border: '1.5px solid #e0e3e8', borderRadius: 8,
    fontSize: 14, outline: 'none',
    transition: 'border-color 0.15s',
  },
  error: {
    background: '#fef2f2', border: '1px solid #fecaca',
    borderRadius: 8, padding: '10px 14px',
    color: '#dc2626', fontSize: 13, marginBottom: 16,
  },
  btn: {
    width: '100%', padding: '12px',
    background: '#3b82f6', color: 'white',
    border: 'none', borderRadius: 8,
    fontSize: 15, fontWeight: 700,
    marginTop: 4,
    transition: 'background 0.15s',
  },
}
