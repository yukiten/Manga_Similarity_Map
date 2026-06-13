import { useState, useEffect } from 'react'

const API = 'http://localhost:8000'

const LANGUAGE_OPTIONS = [
  { code: 'ja', label: '日本語' },
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
  { code: 'ko', label: '한국어' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
]

const LANG_LABEL = Object.fromEntries(LANGUAGE_OPTIONS.map(l => [l.code, l.label]))

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso?.slice(0, 10) ?? ''
  }
}

/**
 * あらすじ表示 + コミュニティ翻訳セクション
 *
 * - 翻訳あり → 最多 upvote の翻訳を本文として表示
 * - 翻訳なし → fallbackSynopsis（AniList 英語）を表示
 * - 投稿フォームで新しい翻訳を追加できる
 */
export default function SynopsisTranslation({
  mangaId,
  fallbackSynopsis,
  primaryColor,
  theme = 'light',
  fontSize = 14,
  fullscreen = false,
}) {
  const isDark = theme === 'dark'
  const UI = isDark ? {
    surface: 'rgba(255,255,255,0.04)',
    border: '#1e2535',
    borderSoft: '#252f42',
    text: '#e2e8f0',
    muted: '#6b7280',
    muteLight: '#4b5563',
    accent: '#818cf8',
    accentBg: 'rgba(129,140,248,0.10)',
    accentBorder: 'rgba(129,140,248,0.35)',
    btnBg: 'rgba(255,255,255,0.04)',
    btnBorder: '#1e2535',
    btnText: '#9ca3af',
    inputBg: 'rgba(255,255,255,0.06)',
    synopsisText: '#94a3b8',
    enBadgeBg: 'rgba(255,255,255,0.06)',
    enBadgeBorder: '#2d3748',
    enBadgeText: '#6b7280',
  } : {
    surface: '#f8faff',
    border: '#e5e9f2',
    borderSoft: '#e8e6df',
    text: '#1f2937',
    muted: '#9aa1b2',
    muteLight: '#c0bdb8',
    accent: '#6d6af8',
    accentBg: 'rgba(109,106,248,0.08)',
    accentBorder: 'rgba(109,106,248,0.30)',
    btnBg: '#faf9f5',
    btnBorder: '#e0ddd8',
    btnText: '#8a8880',
    inputBg: '#ffffff',
    synopsisText: '#475569',
    enBadgeBg: 'rgba(0,0,0,0.04)',
    enBadgeBorder: '#ddd9d4',
    enBadgeText: '#b0aaa4',
  }

  const [translations, setTranslations] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAllTranslations, setShowAllTranslations] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [voted, setVoted] = useState(() => {
    try { return JSON.parse(localStorage.getItem('voted_translations') || '{}') } catch { return {} }
  })

  // form state
  const [lang, setLang] = useState('ja')
  const [body, setBody] = useState('')
  const [author, setAuthor] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setTranslations([])
    setLoading(true)
    setShowAllTranslations(false)
    setShowForm(false)
    fetch(`${API}/api/manga/${mangaId}/translations`)
      .then(r => r.json())
      .then(data => { setTranslations(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [mangaId])

  const handleVote = async (id) => {
    if (voted[id]) return
    try {
      const res = await fetch(`${API}/api/translations/${id}/vote`, { method: 'POST' })
      if (!res.ok) return
      const updated = await res.json()
      setTranslations(prev =>
        [...prev.map(t => t.id === id ? { ...t, upvotes: updated.upvotes } : t)]
          .sort((a, b) => b.upvotes - a.upvotes)
      )
      const next = { ...voted, [id]: true }
      setVoted(next)
      localStorage.setItem('voted_translations', JSON.stringify(next))
    } catch {}
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!body.trim()) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`${API}/api/manga/${mangaId}/translations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: lang, body: body.trim(), author: author.trim() || 'Anonymous' }),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.detail || '送信に失敗しました')
        setSubmitting(false)
        return
      }
      const newT = await res.json()
      setTranslations(prev => [newT, ...prev].sort((a, b) => b.upvotes - a.upvotes))
      setBody('')
      setAuthor('')
      setShowForm(false)
    } catch {
      setError('送信に失敗しました')
    }
    setSubmitting(false)
  }

  // 最多 upvote の翻訳（あれば）
  const bestTranslation = translations.length > 0 ? translations[0] : null
  const otherTranslations = translations.slice(1)

  // ── あらすじ本文 ────────────────────────────────────────────────────────────
  const synopsisText    = bestTranslation ? bestTranslation.body : (fallbackSynopsis || '—')
  const isTranslated    = !!bestTranslation
  const synopsisLangCode = isTranslated ? bestTranslation.language : 'en'
  const synopsisLang    = LANG_LABEL[synopsisLangCode] || synopsisLangCode

  return (
    <>
      {/* ── Synopsis ────────────────────────────────────────────────────── */}
      <div style={{ padding: fullscreen ? '0 0 20px' : '20px 22px 14px' }}>
        {/* ヘッダー */}
        <div style={{
          fontSize: fullscreen ? 10 : 11,
          color: UI.muteLight,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          marginBottom: fullscreen ? 12 : 10,
          fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          Synopsis
          {/* 言語バッジ */}
          {!loading && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
              background: isTranslated ? UI.accentBg : UI.enBadgeBg,
              border: `1px solid ${isTranslated ? UI.accentBorder : UI.enBadgeBorder}`,
              color: isTranslated ? UI.accent : UI.enBadgeText,
              letterSpacing: '0.06em',
            }}>
              {synopsisLang}
            </span>
          )}
          {/* 翻訳者クレジット */}
          {isTranslated && !loading && (
            <span style={{ fontSize: 10, color: UI.muted, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
              by {bestTranslation.author}
            </span>
          )}
        </div>

        {/* 本文 */}
        <p style={{
          fontSize: fullscreen ? 15 : fontSize,
          color: UI.synopsisText,
          lineHeight: fullscreen ? 1.9 : 1.8,
          margin: 0,
          whiteSpace: 'pre-wrap',
        }}>
          {loading ? (fallbackSynopsis || '—') : synopsisText}
        </p>
      </div>

      {/* ── Community Translations ───────────────────────────────────────── */}
      <div style={{ padding: fullscreen ? '0 0 4px' : '0 22px 20px' }}>
        {/* セクションヘッダー */}
        <div style={{
          borderTop: `1px solid ${UI.borderSoft}`, paddingTop: 14, marginBottom: 12,
        }}>
          {/* タイトル行 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{
              fontSize: 11, color: UI.muteLight,
              letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600,
              flex: 1,
            }}>
              あらすじの翻訳
            </span>
            {!loading && translations.length > 0 && (
              <span style={{ fontSize: 11, color: UI.muted }}>{translations.length}件</span>
            )}
            <button
              onClick={() => { setShowForm(f => !f); setError('') }}
              style={{
                fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 7,
                background: showForm ? UI.accentBg : UI.btnBg,
                border: `1px solid ${showForm ? UI.accentBorder : UI.btnBorder}`,
                color: showForm ? UI.accent : UI.btnText,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {showForm ? 'キャンセル' : '+ 翻訳を投稿'}
            </button>
          </div>
          {/* サブテキスト */}
          <p style={{ fontSize: 11, color: UI.muted, margin: 0, lineHeight: 1.6 }}>
            上記の英語あらすじをあなたの言語に翻訳して投稿できます。upvote が多い翻訳があらすじとして表示されます。
          </p>
        </div>

        {/* 投稿フォーム */}
        {showForm && (
          <form onSubmit={handleSubmit} style={{
            background: UI.accentBg,
            border: `1px solid ${UI.accentBorder}`,
            borderRadius: 12, padding: '14px 16px', marginBottom: 14,
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 120 }}>
                <label style={{ fontSize: 10, color: UI.muted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>言語</label>
                <select
                  value={lang}
                  onChange={e => setLang(e.target.value)}
                  style={{
                    background: UI.inputBg, border: `1px solid ${UI.btnBorder}`,
                    borderRadius: 7, padding: '6px 10px',
                    fontSize: 13, color: UI.text, outline: 'none',
                  }}
                >
                  {LANGUAGE_OPTIONS.map(l => (
                    <option key={l.code} value={l.code}>{l.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 2, minWidth: 140 }}>
                <label style={{ fontSize: 10, color: UI.muted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>投稿者名（任意）</label>
                <input
                  type="text"
                  value={author}
                  onChange={e => setAuthor(e.target.value)}
                  placeholder="Anonymous"
                  maxLength={30}
                  style={{
                    background: UI.inputBg, border: `1px solid ${UI.btnBorder}`,
                    borderRadius: 7, padding: '6px 10px',
                    fontSize: 13, color: UI.text, outline: 'none',
                  }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 10, color: UI.muted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
                翻訳テキスト <span style={{ color: UI.accent }}>*</span>
              </label>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="あらすじの翻訳を入力してください..."
                rows={5}
                maxLength={3000}
                required
                style={{
                  background: UI.inputBg, border: `1px solid ${UI.btnBorder}`,
                  borderRadius: 7, padding: '8px 10px',
                  fontSize: 13, color: UI.text, outline: 'none',
                  resize: 'vertical', lineHeight: 1.7,
                  fontFamily: 'inherit',
                }}
              />
              <div style={{ fontSize: 10, color: UI.muted, textAlign: 'right' }}>{body.length} / 3000</div>
            </div>
            {error && (
              <div style={{ fontSize: 12, color: '#ef4444', padding: '6px 10px', background: 'rgba(239,68,68,0.08)', borderRadius: 6, border: '1px solid rgba(239,68,68,0.25)' }}>
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={submitting || !body.trim()}
              style={{
                alignSelf: 'flex-end',
                padding: '8px 18px', borderRadius: 8,
                cursor: (submitting || !body.trim()) ? 'default' : 'pointer',
                background: (submitting || !body.trim()) ? UI.btnBg : UI.accent,
                border: `1px solid ${(submitting || !body.trim()) ? UI.btnBorder : UI.accent}`,
                color: (submitting || !body.trim()) ? UI.btnText : '#fff',
                fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
              }}
            >
              {submitting ? '送信中...' : '投稿する'}
            </button>
          </form>
        )}

        {/* 翻訳リスト */}
        {loading ? null : translations.length === 0 ? (
          <div style={{ fontSize: 12, color: UI.muted, lineHeight: 1.7 }}>
            まだあらすじの翻訳がありません。上のボタンから最初の翻訳を投稿してみましょう！
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* ベスト翻訳（すでに上部に表示済みだが投票はここから） */}
            {[bestTranslation, ...(showAllTranslations ? otherTranslations : [])].filter(Boolean).map((t, idx) => (
              <div
                key={t.id}
                style={{
                  background: idx === 0 ? UI.accentBg : UI.surface,
                  border: `1px solid ${idx === 0 ? UI.accentBorder : UI.borderSoft}`,
                  borderRadius: 10, padding: '12px 14px',
                }}
              >
                {/* ヘッダー */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  {idx === 0 && (
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: UI.accentBg, border: `1px solid ${UI.accentBorder}`, color: UI.accent, letterSpacing: '0.08em' }}>
                      BEST
                    </span>
                  )}
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                    background: 'rgba(255,255,255,0.06)', border: `1px solid ${UI.borderSoft}`,
                    color: UI.muted, letterSpacing: '0.05em',
                  }}>
                    {LANG_LABEL[t.language] || t.language}
                  </span>
                  <span style={{ fontSize: 11, color: UI.muted, flex: 1 }}>by {t.author}</span>
                  <span style={{ fontSize: 10, color: UI.muteLight }}>{formatDate(t.created_at)}</span>
                </div>

                {/* 本文 */}
                <p style={{ fontSize: 13, color: UI.synopsisText, lineHeight: 1.8, margin: '0 0 10px', whiteSpace: 'pre-wrap' }}>
                  {t.body}
                </p>

                {/* 投票 */}
                <button
                  onClick={() => handleVote(t.id)}
                  disabled={!!voted[t.id]}
                  title={voted[t.id] ? '投票済み' : 'この翻訳に投票'}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', borderRadius: 6,
                    cursor: voted[t.id] ? 'default' : 'pointer',
                    background: voted[t.id] ? UI.accentBg : UI.btnBg,
                    border: `1px solid ${voted[t.id] ? UI.accentBorder : UI.btnBorder}`,
                    color: voted[t.id] ? UI.accent : UI.btnText,
                    fontSize: 12, fontWeight: 600, transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: 13 }}>{voted[t.id] ? '▲' : '△'}</span>
                  <span>{t.upvotes}</span>
                </button>
              </div>
            ))}

            {otherTranslations.length > 0 && (
              <button
                onClick={() => setShowAllTranslations(e => !e)}
                style={{
                  fontSize: 12, color: UI.accent, background: 'none', border: 'none',
                  cursor: 'pointer', padding: '2px 0', textAlign: 'left',
                }}
              >
                {showAllTranslations
                  ? '▲ 折りたたむ'
                  : `▼ 他の翻訳を表示 (${otherTranslations.length}件)`}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  )
}
