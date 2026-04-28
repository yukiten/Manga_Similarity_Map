import { useState, useEffect } from 'react'

function StarInput({ value, onChange }) {
  const [hover, setHover] = useState(0)
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <span
          key={n}
          onClick={() => onChange(n)}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          style={{
            fontSize: 22, cursor: 'pointer',
            color: n <= (hover || value) ? '#ffe066' : '#2a2a48',
            transition: 'color 0.1s',
            textShadow: n <= (hover || value) ? '0 0 8px #ffe06688' : 'none',
          }}
        >★</span>
      ))}
    </div>
  )
}

function StarDisplay({ rating, size = 14 }) {
  return (
    <span style={{ fontSize: size, letterSpacing: 1 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <span key={n} style={{ color: n <= rating ? '#ffe066' : '#2a2a48' }}>★</span>
      ))}
    </span>
  )
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

export default function ReviewSection({ mangaId, primaryColor }) {
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [author, setAuthor] = useState('')
  const [rating, setRating] = useState(0)
  const [body, setBody] = useState('')

  useEffect(() => {
    setLoading(true)
    setReviews([])
    fetch(`/api/manga/${encodeURIComponent(mangaId)}/reviews`)
      .then(r => r.json())
      .then(data => { setReviews(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [mangaId])

  async function handleSubmit(e) {
    e.preventDefault()
    if (rating === 0) { setError('評価を選んでください'); return }
    if (!body.trim()) { setError('レビュー本文を入力してください'); return }
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`/api/manga/${encodeURIComponent(mangaId)}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: author.trim() || 'Anonymous', rating, body: body.trim() }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.detail || 'エラーが発生しました')
      }
      const newReview = await res.json()
      setReviews(prev => [newReview, ...prev])
      setShowForm(false)
      setAuthor(''); setRating(0); setBody('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const avgRating = reviews.length
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : null

  return (
    <div style={{ padding: '20px 22px', borderTop: '1px solid #191928' }}>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: '#484890', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600 }}>
            Reviews
          </span>
          {avgRating && (
            <span style={{
              fontSize: 12, fontWeight: 700, color: '#ffe066',
              background: 'rgba(255,224,102,0.10)', border: '1px solid rgba(255,224,102,0.22)',
              borderRadius: 6, padding: '2px 8px',
            }}>
              ★ {avgRating} <span style={{ color: '#505070', fontWeight: 400 }}>({reviews.length})</span>
            </span>
          )}
        </div>
        <button
          onClick={() => { setShowForm(v => !v); setError('') }}
          style={{
            fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
            padding: '5px 12px', borderRadius: 7,
            border: `1px solid ${showForm ? primaryColor + '80' : '#2a2a48'}`,
            background: showForm ? `${primaryColor}18` : 'transparent',
            color: showForm ? primaryColor : '#505070',
            cursor: 'pointer', transition: 'all 0.15s',
          }}
        >
          {showForm ? 'キャンセル' : '+ レビューを書く'}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} style={{
          background: '#0f0f1e', border: `1px solid ${primaryColor}30`,
          borderRadius: 12, padding: '16px', marginBottom: 16,
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 11, color: '#484870', marginBottom: 6, letterSpacing: '0.06em' }}>評価</div>
            <StarInput value={rating} onChange={setRating} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#484870', marginBottom: 6, letterSpacing: '0.06em' }}>名前（省略可）</div>
            <input
              value={author}
              onChange={e => setAuthor(e.target.value)}
              placeholder="Anonymous"
              maxLength={50}
              style={{
                width: '100%', background: '#14142a', border: '1px solid #252545',
                borderRadius: 8, padding: '8px 12px', color: '#c0c0e0', fontSize: 13,
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#484870', marginBottom: 6, letterSpacing: '0.06em' }}>レビュー</div>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="この作品について感想を書いてください…"
              maxLength={2000}
              rows={4}
              style={{
                width: '100%', background: '#14142a', border: '1px solid #252545',
                borderRadius: 8, padding: '8px 12px', color: '#c0c0e0', fontSize: 13,
                outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
            <div style={{ fontSize: 10, color: '#303050', textAlign: 'right', marginTop: 3 }}>
              {body.length} / 2000
            </div>
          </div>
          {error && <div style={{ fontSize: 12, color: '#f87171' }}>{error}</div>}
          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: '9px 20px', borderRadius: 8,
              background: submitting ? '#1e1e38' : `linear-gradient(135deg, ${primaryColor}cc, ${primaryColor}88)`,
              border: 'none', color: '#fff', fontSize: 13, fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer', transition: 'opacity 0.15s',
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? '送信中…' : '投稿する'}
          </button>
        </form>
      )}

      {/* Review list */}
      {loading ? (
        <div style={{ fontSize: 12, color: '#363660', padding: '8px 0' }}>読み込み中…</div>
      ) : reviews.length === 0 ? (
        <div style={{ fontSize: 13, color: '#303050', padding: '4px 0' }}>
          まだレビューがありません。最初のレビューを書いてみましょう。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {reviews.map(r => (
            <div key={r.id} style={{
              background: '#0d0d1c', border: '1px solid #1a1a2e',
              borderRadius: 10, padding: '12px 14px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#9090c0' }}>{r.author}</span>
                  <StarDisplay rating={r.rating} />
                </div>
                <span style={{ fontSize: 11, color: '#303050', flexShrink: 0 }}>{formatDate(r.created_at)}</span>
              </div>
              <p style={{ fontSize: 13, color: '#8080aa', lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>
                {r.body}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
