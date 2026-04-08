import { useState } from 'react'
import { api } from '../api'

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { agent, token } = await api.login(username, password)
      onLogin(agent, token)
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>📞</div>
        <h1 style={styles.brand}><span style={{ color: '#4f9cf9' }}>BTI</span> Voice</h1>
        <p style={styles.sub}>Shared SMS & Call Inbox</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Username</label>
            <input
              style={styles.input}
              type="text"
              placeholder="e.g. shawn"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <input
              style={styles.input}
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <div style={styles.error}>{error}</div>}
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
    minHeight: '100vh',
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
