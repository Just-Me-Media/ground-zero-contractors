import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const { login } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    let eAddr = email.trim()
    if (!eAddr.includes('@')) {
      eAddr += '@gzci.ca'
    }
    try {
      await login(eAddr, password)
      navigate('/')
    } catch (err) {
      setError(err.message || 'Login failed')
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f8f9fa',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem'
    }}>
      <div style={{
        background: '#ffffff',
        borderRadius: 8,
        padding: '2.5rem',
        width: '100%',
        maxWidth: 400,
        boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
        border: '1px solid #e4e4e7'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: '2rem'
        }}>
          <img src="/logo-small.png" alt="Ground Zero Contractors" style={{ height: 38, width: 'auto' }} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 13, color: '#000000', letterSpacing: 1.5 }}>GROUND ZERO</div>
            <div style={{ fontWeight: 600, fontSize: 10, color: '#71717a', letterSpacing: 1 }}>CONTRACTORS INC.</div>
          </div>
        </div>

        <h2 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: '1.5rem', color: '#000000', letterSpacing: '-0.3px' }}>Staff / Client Login</h2>

        {error && (
          <div style={{
            background: '#fef2f2',
            color: '#b91c1c',
            padding: '0.6rem 1rem',
            borderRadius: 4,
            fontSize: '0.85rem',
            marginBottom: '1rem',
            border: '1px solid #fecaca'
          }}>{error}</div>
        )}

        <form onSubmit={handleSubmit}>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#000000', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Email
          </label>
          <input
            type="text"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@gzci.ca"
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid #d4d4d8',
              borderRadius: 4,
              fontSize: '0.95rem',
              marginBottom: '1rem',
              outline: 'none',
              background: '#ffffff'
            }}
          />

          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#000000', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Enter password"
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid #d4d4d8',
              borderRadius: 4,
              fontSize: '0.95rem',
              marginBottom: '1.5rem',
              outline: 'none',
              background: '#ffffff'
            }}
          />

          <button
            type="submit"
            style={{
              width: '100%',
              padding: '12px',
              background: '#000000',
              color: '#ffffff',
              border: '1px solid #000000',
              borderRadius: 4,
              fontSize: '0.95rem',
              fontWeight: 700,
              cursor: 'pointer',
              letterSpacing: 0.5,
              transition: 'background 0.2s'
            }}
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  )
}
