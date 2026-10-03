import { useState } from 'react'
import { api, setSession } from '../api'
import { BRAND } from '../ui'

export default function Login({ onLogin, notice }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState(notice || '')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const { agent, token } = await api.login(username, password, remember)
      setSession(agent, token)
      onLogin(agent)
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally { setBusy(false) }
  }

  return (
    <div className="login">
      <form className="box" onSubmit={submit}>
        <div className="brand">
          <div className="logo">BH</div>
          <div>
            <h1>{BRAND}</h1>
            <p>Sign in with your BTI Voice account</p>
          </div>
        </div>
        <input className="field" placeholder="Username" autoFocus autoCapitalize="none" value={username} onChange={e => setUsername(e.target.value)} />
        <input className="field" placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        <label className="check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /> Keep me signed in</label>
        {error && <div className="error">{error}</div>}
        <button className="btn primary" type="submit" disabled={busy || !username || !password} style={{ justifyContent: 'center' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
