import { useState } from 'react'

export default function AuthModal({ onSuccess, onClose, theme = 'light' }) {
  const isLight = theme === 'light'
  const [mode, setMode]       = useState('login')   // 'login' | 'register'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

  const bg        = isLight ? '#faf9f5' : '#111827'
  const border    = isLight ? '#d6dbe8' : '#1e2535'
  const text      = isLight ? '#0f172a' : '#e2e8f0'
  const textSub   = isLight ? '#334155' : '#9ca3af'
  const textMuted = isLight ? '#64748b' : '#6b7280'
  const inputBg   = isLight ? '#fff'    : '#0d1117'
  const accent    = isLight ? '#4f46e5' : '#818cf8'
  const accentBg  = isLight ? 'rgba(79,70,229,0.12)'  : 'rgba(129,140,248,0.12)'
  const overlay   = isLight ? 'rgba(15,23,42,0.35)'   : 'rgba(0,0,0,0.65)'

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.detail || 'エラーが発生しました')
        return
      }
      onSuccess(data.token, data.username)
    } catch {
      setError('サーバーに接続できませんでした')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    width: '100%', padding: '9px 12px', borderRadius: 8,
    border: `1px solid ${border}`, background: inputBg,
    color: text, fontSize: 14, outline: 'none', boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: overlay, backdropFilter: 'blur(4px)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: 360, borderRadius: 16, background: bg,
        border: `1px solid ${border}`,
        boxShadow: isLight
          ? '0 20px 60px rgba(15,23,42,0.18)'
          : '0 20px 60px rgba(0,0,0,0.7)',
        padding: '28px 28px 24px',
        display: 'flex', flexDirection: 'column', gap: 20,
      }}>
        {/* ヘッダー */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 2, background: isLight ? '#f0eee8' : '#0d1117', borderRadius: 8, padding: 3 }}>
            {[['login', 'ログイン'], ['register', '新規登録']].map(([m, label]) => (
              <button key={m} onClick={() => { setMode(m); setError('') }}
                style={{
                  padding: '5px 14px', borderRadius: 6, border: 'none',
                  background: mode === m ? (isLight ? '#fff' : '#1e2535') : 'transparent',
                  color: mode === m ? accent : textMuted,
                  fontWeight: mode === m ? 700 : 500, fontSize: 13, cursor: 'pointer',
                  boxShadow: mode === m ? (isLight ? '0 1px 4px rgba(15,23,42,0.10)' : 'none') : 'none',
                  transition: 'all 0.15s',
                }}
              >{label}</button>
            ))}
          </div>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', color: textMuted, fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '2px 6px', borderRadius: 6 }}
          >✕</button>
        </div>

        {/* フォーム */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: textSub }}>ユーザー名</label>
            <input
              type="text" value={username} onChange={e => setUsername(e.target.value)}
              placeholder="例: taro_manga"
              required autoFocus autoComplete="username"
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = accent}
              onBlur={e => e.target.style.borderColor = border}
            />
            {mode === 'register' && (
              <div style={{ fontSize: 11, color: textMuted }}>3〜30文字の英数字・_・- が使えます</div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: textSub }}>パスワード</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder={mode === 'register' ? '6文字以上' : ''}
              required autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = accent}
              onBlur={e => e.target.style.borderColor = border}
            />
          </div>

          {error && (
            <div style={{
              fontSize: 13, color: '#ef4444', background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8,
              padding: '8px 12px',
            }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading}
            style={{
              width: '100%', padding: '10px', borderRadius: 8, border: 'none',
              background: loading ? accentBg : accent,
              color: loading ? accent : '#fff',
              fontWeight: 700, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {loading ? '処理中…' : mode === 'login' ? 'ログイン' : 'アカウントを作成'}
          </button>
        </form>

        <div style={{ fontSize: 11, color: textMuted, textAlign: 'center', lineHeight: 1.7 }}>
          {mode === 'register'
            ? 'アカウント作成後、このデバイスのお気に入り・閲覧済みは自動で引き継がれます。'
            : 'お気に入りや閲覧履歴を端末をまたいで同期できます。'}
        </div>
      </div>
    </div>
  )
}
