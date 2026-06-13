import { useState, useEffect } from 'react'

function getUI(theme) {
  const isDark = theme === 'dark'
  return {
    borderTop:    isDark ? '#191928'              : '#e5e7f0',
    labelColor:   isDark ? '#484890'              : '#6b7280',
    avgBg:        isDark ? 'rgba(255,224,102,0.10)' : 'rgba(180,140,0,0.08)',
    avgBorder:    isDark ? 'rgba(255,224,102,0.22)' : 'rgba(180,140,0,0.20)',
    avgColor:     isDark ? '#ffe066'              : '#b28a00',
    avgSub:       isDark ? '#505070'              : '#9ca3af',
    btnBorder:    isDark ? '#2a2a48'              : '#e0ddd8',
    btnText:      isDark ? '#505070'              : '#6b7280',
    formBg:       isDark ? '#0f0f1e'              : '#f8f7f3',
    inputBg:      isDark ? '#14142a'              : '#ffffff',
    inputBorder:  isDark ? '#252545'              : '#e0ddd8',
    inputText:    isDark ? '#c0c0e0'              : '#1f2937',
    inputPlaceholder: isDark ? '#40406a'          : '#aaa8a4',
    fieldLabel:   isDark ? '#484870'              : '#6b7280',
    charCounter:  isDark ? '#303050'              : '#aaa8a4',
    errorText:    '#f87171',
    btnDisabledBg: isDark ? '#1e1e38'             : '#ede9e3',
    btnDisabledText: isDark ? '#404060'           : '#bbb8b4',
    loadingText:  isDark ? '#363660'              : '#9ca3af',
    emptyText:    isDark ? '#303050'              : '#9ca3af',
    cardBg:       isDark ? '#0d0d1c'              : '#ffffff',
    cardBorder:   isDark ? '#1a1a2e'              : '#eae8e2',
    authorText:   isDark ? '#9090c0'              : '#374151',
    starLit:      isDark ? '#ffe066'              : '#d97706',
    starUnlit:    isDark ? '#2a2a48'              : '#d1d5db',
    bodyText:     isDark ? '#8080aa'              : '#4b5563',
    dateText:     isDark ? '#303050'              : '#9ca3af',
    mutedBtn:     isDark ? '#404070'              : '#9ca3af',
    ownText:      isDark ? '#505070'              : '#6b7280',
  }
}

function StarInput({ value, onChange, UI }) {
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
            color: n <= (hover || value) ? UI.starLit : UI.starUnlit,
            transition: 'color 0.1s',
            textShadow: n <= (hover || value) ? `0 0 8px ${UI.starLit}88` : 'none',
          }}
        >★</span>
      ))}
    </div>
  )
}

function StarDisplay({ rating, UI, size = 14 }) {
  return (
    <span style={{ fontSize: size, letterSpacing: 1 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <span key={n} style={{ color: n <= rating ? UI.starLit : UI.starUnlit }}>★</span>
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

export default function ReviewSection({ mangaId, primaryColor, authToken, currentUser, theme = 'dark' }) {
  const UI = getUI(theme)

  const [reviews, setReviews]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [showForm, setShowForm]     = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')

  const [author, setAuthor] = useState('')
  const [rating, setRating] = useState(0)
  const [body, setBody]     = useState('')

  const [editId, setEditId]         = useState(null)
  const [editRating, setEditRating] = useState(0)
  const [editBody, setEditBody]     = useState('')
  const [editError, setEditError]   = useState('')
  const [editSaving, setEditSaving] = useState(false)

  useEffect(() => {
    setLoading(true)
    setReviews([])
    fetch(`/api/manga/${encodeURIComponent(mangaId)}/reviews`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    })
      .then(r => r.json())
      .then(data => { setReviews(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [mangaId, authToken])

  async function handleSubmit(e) {
    e.preventDefault()
    if (rating === 0) { setError('評価を選んでください'); return }
    if (!body.trim()) { setError('レビュー本文を入力してください'); return }
    setSubmitting(true); setError('')
    try {
      const res = await fetch(`/api/manga/${encodeURIComponent(mangaId)}/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          author: currentUser || author.trim() || 'Anonymous',
          rating,
          body: body.trim(),
        }),
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

  function startEdit(r) { setEditId(r.id); setEditRating(r.rating); setEditBody(r.body); setEditError('') }
  function cancelEdit() { setEditId(null); setEditError('') }

  async function handleUpdate(e) {
    e.preventDefault()
    if (editRating === 0) { setEditError('評価を選んでください'); return }
    if (!editBody.trim()) { setEditError('レビュー本文を入力してください'); return }
    setEditSaving(true); setEditError('')
    try {
      const res = await fetch(`/api/manga/${encodeURIComponent(mangaId)}/reviews/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ rating: editRating, body: editBody.trim() }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.detail || 'エラーが発生しました')
      }
      const updated = await res.json()
      setReviews(prev => prev.map(r => r.id === editId ? updated : r))
      setEditId(null)
    } catch (err) {
      setEditError(err.message)
    } finally {
      setEditSaving(false)
    }
  }

  async function handleDelete(reviewId) {
    if (!window.confirm('このレビューを削除しますか？')) return
    try {
      const res = await fetch(`/api/manga/${encodeURIComponent(mangaId)}/reviews/${reviewId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      })
      if (!res.ok && res.status !== 204) throw new Error('削除に失敗しました')
      setReviews(prev => prev.filter(r => r.id !== reviewId))
    } catch (err) {
      alert(err.message)
    }
  }

  const avgRating = reviews.length
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : null

  const inputStyle = {
    width: '100%', background: UI.inputBg,
    border: `1px solid ${UI.inputBorder}`,
    borderRadius: 8, padding: '8px 12px', color: UI.inputText, fontSize: 13,
    outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div style={{ padding: '20px 22px', borderTop: `1px solid ${UI.borderTop}` }}>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: UI.labelColor, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600 }}>
            Reviews
          </span>
          {avgRating && (
            <span style={{
              fontSize: 12, fontWeight: 700, color: UI.avgColor,
              background: UI.avgBg, border: `1px solid ${UI.avgBorder}`,
              borderRadius: 6, padding: '2px 8px',
            }}>
              ★ {avgRating} <span style={{ color: UI.avgSub, fontWeight: 400 }}>({reviews.length})</span>
            </span>
          )}
        </div>
        <button
          onClick={() => { setShowForm(v => !v); setError('') }}
          style={{
            fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
            padding: '5px 12px', borderRadius: 7,
            border: `1px solid ${showForm ? primaryColor + '80' : UI.btnBorder}`,
            background: showForm ? `${primaryColor}18` : 'transparent',
            color: showForm ? primaryColor : UI.btnText,
            cursor: 'pointer', transition: 'all 0.15s',
          }}
        >
          {showForm ? 'キャンセル' : '+ レビューを書く'}
        </button>
      </div>

      {/* Post form */}
      {showForm && (
        <form onSubmit={handleSubmit} style={{
          background: UI.formBg, border: `1px solid ${primaryColor}30`,
          borderRadius: 12, padding: '16px', marginBottom: 16,
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 11, color: UI.fieldLabel, marginBottom: 6, letterSpacing: '0.06em' }}>評価</div>
            <StarInput value={rating} onChange={setRating} UI={UI} />
          </div>
          {currentUser ? (
            <div style={{ fontSize: 12, color: UI.fieldLabel }}>
              投稿者: <span style={{ color: primaryColor, fontWeight: 600 }}>{currentUser}</span>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 11, color: UI.fieldLabel, marginBottom: 6, letterSpacing: '0.06em' }}>名前（省略可）</div>
              <input
                value={author}
                onChange={e => setAuthor(e.target.value)}
                placeholder="Anonymous"
                maxLength={50}
                style={inputStyle}
              />
            </div>
          )}
          <div>
            <div style={{ fontSize: 11, color: UI.fieldLabel, marginBottom: 6, letterSpacing: '0.06em' }}>レビュー</div>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="この作品について感想を書いてください…"
              maxLength={2000}
              rows={4}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />
            <div style={{ fontSize: 10, color: UI.charCounter, textAlign: 'right', marginTop: 3 }}>
              {body.length} / 2000
            </div>
          </div>
          {error && <div style={{ fontSize: 12, color: UI.errorText }}>{error}</div>}
          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: '9px 20px', borderRadius: 8,
              background: submitting ? UI.btnDisabledBg : `linear-gradient(135deg, ${primaryColor}cc, ${primaryColor}88)`,
              border: 'none',
              color: submitting ? UI.btnDisabledText : '#fff',
              fontSize: 13, fontWeight: 600,
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
        <div style={{ fontSize: 12, color: UI.loadingText, padding: '8px 0' }}>読み込み中…</div>
      ) : reviews.length === 0 ? (
        <div style={{ fontSize: 13, color: UI.emptyText, padding: '4px 0' }}>
          まだレビューがありません。最初のレビューを書いてみましょう。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {reviews.map(r => (
            <div key={r.id} style={{
              background: UI.cardBg,
              border: `1px solid ${r.is_own ? primaryColor + '40' : UI.cardBorder}`,
              borderRadius: 10, padding: '12px 14px',
            }}>
              {editId === r.id ? (
                <form onSubmit={handleUpdate} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <StarInput value={editRating} onChange={setEditRating} UI={UI} />
                  <textarea
                    value={editBody}
                    onChange={e => setEditBody(e.target.value)}
                    maxLength={2000}
                    rows={4}
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                  />
                  {editError && <div style={{ fontSize: 12, color: UI.errorText }}>{editError}</div>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="submit" disabled={editSaving} style={{
                      padding: '6px 16px', borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 600,
                      background: editSaving ? UI.btnDisabledBg : `${primaryColor}cc`,
                      color: editSaving ? UI.btnDisabledText : '#fff',
                      cursor: editSaving ? 'not-allowed' : 'pointer',
                    }}>
                      {editSaving ? '保存中…' : '保存'}
                    </button>
                    <button type="button" onClick={cancelEdit} style={{
                      padding: '6px 16px', borderRadius: 7,
                      border: `1px solid ${UI.btnBorder}`,
                      background: 'transparent', color: UI.btnText, fontSize: 12, cursor: 'pointer',
                    }}>
                      キャンセル
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <a
                        href={`/user/${r.author}`}
                        style={{ fontSize: 13, fontWeight: 600, color: r.is_own ? primaryColor : UI.authorText, textDecoration: 'none' }}
                        onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                        onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                      >
                        {r.author}
                        {r.is_own && (
                          <span style={{ fontSize: 10, color: UI.ownText, marginLeft: 5, fontWeight: 400 }}>あなた</span>
                        )}
                      </a>
                      <StarDisplay rating={r.rating} UI={UI} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: UI.dateText }}>{formatDate(r.created_at)}</span>
                      {r.is_own && (
                        <>
                          <button onClick={() => startEdit(r)} style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: 11, color: UI.mutedBtn, padding: '1px 4px', lineHeight: 1,
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = primaryColor}
                          onMouseLeave={e => e.currentTarget.style.color = UI.mutedBtn}
                          >編集</button>
                          <button onClick={() => handleDelete(r.id)} style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: 11, color: UI.mutedBtn, padding: '1px 4px', lineHeight: 1,
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                          onMouseLeave={e => e.currentTarget.style.color = UI.mutedBtn}
                          >削除</button>
                        </>
                      )}
                    </div>
                  </div>
                  <p style={{ fontSize: 13, color: UI.bodyText, lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>
                    {r.body}
                  </p>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
