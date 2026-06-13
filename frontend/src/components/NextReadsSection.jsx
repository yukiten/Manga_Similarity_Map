import { useState, useEffect, useRef } from 'react'
import { getTagColor } from '../utils'
import { getCoverUrl } from '../lib/imageSource'

function getUI(theme) {
  const isDark = theme === 'dark'
  return {
    borderTop:      isDark ? '#191928'              : '#e5e7f0',
    labelColor:     isDark ? '#484890'              : '#6b7280',
    subLabel:       isDark ? '#303058'              : '#9ca3af',
    btnBorder:      isDark ? '#2a2a48'              : '#e0ddd8',
    btnText:        isDark ? '#505070'              : '#6b7280',
    formBg:         isDark ? '#0f0f1e'              : '#f8f7f3',
    inputBg:        isDark ? '#14142a'              : '#ffffff',
    inputBorder:    isDark ? '#252545'              : '#e0ddd8',
    inputText:      isDark ? '#c0c0e0'              : '#1f2937',
    fieldLabel:     isDark ? '#484870'              : '#6b7280',
    dropdownBg:     isDark ? '#12122a'              : '#ffffff',
    dropdownBorder: isDark ? '#252545'              : '#e0ddd8',
    dropdownShadow: isDark ? '0 8px 24px rgba(0,0,0,0.6)' : '0 8px 24px rgba(0,0,0,0.12)',
    dropdownHover:  isDark ? '#1a1a38'              : '#f5f3ef',
    dropdownRowBorder: isDark ? '#1a1a30'           : '#f0ede8',
    dropdownTitle:  isDark ? '#c0c0e0'              : '#1f2937',
    dropdownSub:    isDark ? '#505080'              : '#9ca3af',
    errorText:      '#f87171',
    btnDisabledBg:  isDark ? '#1e1e38'              : '#ede9e3',
    btnDisabledText: isDark ? '#404060'             : '#bbb8b4',
    loadingText:    isDark ? '#363660'              : '#9ca3af',
    emptyText:      isDark ? '#303050'              : '#9ca3af',
    cardBg:         isDark ? '#0d0d1c'              : '#ffffff',
    cardBorder:     isDark ? '#1a1a2e'              : '#eae8e2',
    titleText:      isDark ? '#c0c0e0'              : '#1f2937',
    commentText:    isDark ? '#505075'              : '#9ca3af',
    voteBorderIdle: isDark ? '#252540'              : '#e0ddd8',
    voteTextIdle:   isDark ? '#404060'              : '#9ca3af',
    deleteBtnColor: isDark ? '#404060'              : '#9ca3af',
  }
}

// localStorage で投票済みIDを管理（重複投票防止）
function getVotedSet() {
  try { return new Set(JSON.parse(localStorage.getItem('next-read-votes') || '[]')) } catch { return new Set() }
}
function addVoted(id) {
  const s = getVotedSet(); s.add(id)
  try { localStorage.setItem('next-read-votes', JSON.stringify([...s])) } catch {}
}
function getSuggestedSet(mangaId) {
  try { return new Set(JSON.parse(localStorage.getItem(`next-read-suggested-${mangaId}`) || '[]')) } catch { return new Set() }
}
function addSuggested(mangaId, toId) {
  const s = getSuggestedSet(mangaId); s.add(toId)
  try { localStorage.setItem(`next-read-suggested-${mangaId}`, JSON.stringify([...s])) } catch {}
}

function MiniCover({ manga, size = 52 }) {
  const url = getCoverUrl(manga)
  const color = getTagColor(manga?.tags?.[0]?.name || manga?.genre)
  if (!url) return (
    <div style={{
      width: size, height: size * 1.4, borderRadius: 6, flexShrink: 0,
      background: `linear-gradient(160deg, ${color}40 0%, ${color}14 100%)`,
      border: `1px solid ${color}30`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <span style={{ fontSize: 16, opacity: 0.35 }}>📖</span>
    </div>
  )
  return (
    <img
      src={url} alt={manga.title}
      style={{
        width: size, height: size * 1.4, borderRadius: 6, flexShrink: 0,
        objectFit: 'cover', objectPosition: 'center top',
        border: `1px solid ${color}30`,
      }}
      onError={e => { e.currentTarget.style.display = 'none' }}
    />
  )
}

export default function NextReadsSection({ mangaId, allManga = [], onSelect, onSelectSimilarMap, primaryColor, authToken, currentUser, theme = 'dark' }) {
  const UI = getUI(theme)

  const [items, setItems]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [showForm, setShowForm]   = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState('')
  const [voted, setVoted]         = useState(() => getVotedSet())
  const [suggested, setSuggested] = useState(() => getSuggestedSet(mangaId))

  const [query, setQuery]           = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [picked, setPicked]         = useState(null)
  const [comment, setComment]       = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    setLoading(true)
    setItems([])
    setSuggested(getSuggestedSet(mangaId))
    fetch(`/api/manga/${encodeURIComponent(mangaId)}/next-reads`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    })
      .then(r => r.json())
      .then(data => { setItems(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [mangaId])

  useEffect(() => {
    if (!query.trim()) { setSuggestions([]); return }
    const q = query.toLowerCase()
    const results = allManga
      .filter(m => m.id !== mangaId && (
        m.title.toLowerCase().includes(q) ||
        (m.title_ja && m.title_ja.includes(query)) ||
        (m.title_romaji && m.title_romaji.toLowerCase().includes(q))
      ))
      .slice(0, 8)
    setSuggestions(results)
  }, [query, allManga, mangaId])

  function handlePick(manga) {
    setPicked(manga)
    setQuery(manga.title_ja || manga.title)
    setSuggestions([])
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!picked) { setError('作品を選択してください'); return }
    setSubmitting(true); setError('')
    try {
      const res = await fetch(`/api/manga/${encodeURIComponent(mangaId)}/next-reads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ to_manga_id: picked.id, comment: comment.trim() }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.detail || 'エラーが発生しました')
      }
      const data = await res.json()
      const fullManga = allManga.find(m => m.id === data.to_manga_id)
      if (fullManga) data.manga = { id: fullManga.id, title: fullManga.title, title_ja: fullManga.title_ja, cover_url: fullManga.cover_url, score: fullManga.score, genre: fullManga.genre, tags: (fullManga.tags || []).slice(0, 3) }
      setItems(prev => {
        const idx = prev.findIndex(i => i.to_manga_id === data.to_manga_id)
        if (idx >= 0) {
          const next = [...prev]; next[idx] = data; return next.sort((a, b) => b.votes - a.votes)
        }
        return [data, ...prev].sort((a, b) => b.votes - a.votes)
      })
      addSuggested(mangaId, picked.id)
      setSuggested(getSuggestedSet(mangaId))
      setShowForm(false); setPicked(null); setQuery(''); setComment('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(item) {
    if (!window.confirm('このおすすめを削除しますか？')) return
    try {
      const res = await fetch(`/api/next-reads/${item.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      })
      if (!res.ok && res.status !== 204) throw new Error('削除に失敗しました')
      setItems(prev => prev.filter(i => i.id !== item.id))
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleVote(item) {
    if (voted.has(item.id)) return
    try {
      const res = await fetch(`/api/next-reads/${item.id}/vote`, { method: 'POST' })
      if (!res.ok) return
      const data = await res.json()
      setItems(prev =>
        prev.map(i => i.id === item.id ? { ...i, votes: data.votes } : i)
            .sort((a, b) => b.votes - a.votes)
      )
      addVoted(item.id)
      setVoted(getVotedSet())
    } catch {}
  }

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: UI.labelColor, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600 }}>
            Next Reads
          </span>
          <span style={{ fontSize: 11, color: UI.subLabel }}>— 読んだ後はこれ</span>
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
          {showForm ? 'キャンセル' : '+ おすすめを追加'}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} style={{
          background: UI.formBg, border: `1px solid ${primaryColor}30`,
          borderRadius: 12, padding: '16px', marginBottom: 16,
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div style={{ position: 'relative' }}>
            <div style={{ fontSize: 11, color: UI.fieldLabel, marginBottom: 6, letterSpacing: '0.06em' }}>
              次に読む作品を検索
            </div>
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setPicked(null) }}
              placeholder="タイトルで検索…"
              style={{ ...inputStyle, border: `1px solid ${picked ? primaryColor + '60' : UI.inputBorder}` }}
            />
            {suggestions.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                background: UI.dropdownBg, border: `1px solid ${UI.dropdownBorder}`,
                borderRadius: 10, marginTop: 4, overflow: 'hidden',
                boxShadow: UI.dropdownShadow,
              }}>
                {suggestions.map(m => (
                  <div
                    key={m.id}
                    onClick={() => handlePick(m)}
                    style={{
                      padding: '9px 14px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 10,
                      borderBottom: `1px solid ${UI.dropdownRowBorder}`,
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = UI.dropdownHover}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{
                      width: 28, height: 40, borderRadius: 4, flexShrink: 0, overflow: 'hidden',
                      background: `${getTagColor(m.tags?.[0]?.name || m.genre)}22`,
                    }}>
                      {getCoverUrl(m) && (
                        <img src={getCoverUrl(m)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.currentTarget.style.display = 'none' }} />
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, color: UI.dropdownTitle }}>{m.title_ja || m.title}</div>
                      {m.title_ja && <div style={{ fontSize: 11, color: UI.dropdownSub }}>{m.title}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize: 11, color: UI.fieldLabel, marginBottom: 6, letterSpacing: '0.06em' }}>
              おすすめの理由（省略可）
            </div>
            <input
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="なぜこの作品を次に読むべきか…"
              maxLength={200}
              style={inputStyle}
            />
          </div>
          {error && <div style={{ fontSize: 12, color: UI.errorText }}>{error}</div>}
          <button
            type="submit"
            disabled={submitting || !picked}
            style={{
              padding: '9px 20px', borderRadius: 8,
              background: (!picked || submitting) ? UI.btnDisabledBg : `linear-gradient(135deg, ${primaryColor}cc, ${primaryColor}88)`,
              border: 'none',
              color: (!picked || submitting) ? UI.btnDisabledText : '#fff',
              fontSize: 13, fontWeight: 600,
              cursor: (!picked || submitting) ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {submitting ? '送信中…' : '追加する'}
          </button>
        </form>
      )}

      {/* List */}
      {loading ? (
        <div style={{ fontSize: 12, color: UI.loadingText, padding: '8px 0' }}>読み込み中…</div>
      ) : items.length === 0 ? (
        <div style={{ fontSize: 13, color: UI.emptyText, padding: '4px 0' }}>
          まだ登録されていません。この作品を読んだ後のおすすめを教えてください。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map(item => {
            const m = item.manga
            const color = m ? getTagColor(m.tags?.[0]?.name || m.genre) : '#6366f1'
            const hasVoted = voted.has(item.id)
            const hasSuggested = item.is_own || suggested.has(item.to_manga_id)
            return (
              <div key={item.id} style={{
                background: UI.cardBg,
                border: `1px solid ${item.is_own ? color + '40' : UI.cardBorder}`,
                borderRadius: 10, padding: '10px 12px',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                {/* Cover */}
                {m && (
                  <div
                    onClick={() => { const full = allManga.find(x => x.id === m.id) || m; onSelectSimilarMap ? onSelectSimilarMap(full) : onSelect && onSelect(full) }}
                    style={{ cursor: 'pointer', flexShrink: 0 }}
                  >
                    <MiniCover manga={m} size={44} />
                  </div>
                )}
                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    onClick={() => { const full = allManga.find(x => x.id === m?.id) || m; onSelectSimilarMap ? onSelectSimilarMap(full) : onSelect && onSelect(full) }}
                    style={{ fontSize: 13, fontWeight: 600, color: UI.titleText, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}
                    onMouseEnter={e => e.currentTarget.style.color = color}
                    onMouseLeave={e => e.currentTarget.style.color = UI.titleText}
                  >
                    {m ? (m.title_ja || m.title) : item.to_manga_id}
                  </div>
                  {item.comment && (
                    <div style={{ fontSize: 11, color: UI.commentText, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.comment}
                    </div>
                  )}
                  {item.username && !item.is_own && (
                    <a href={`/user/${item.username}`} style={{ fontSize: 10, color: UI.commentText, marginTop: 2, display: 'block', textDecoration: 'none' }}
                      onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                      onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                    >{item.username}</a>
                  )}
                  {hasSuggested && (
                    <div style={{ fontSize: 10, color: primaryColor + '88', marginTop: 2 }}>あなたが追加</div>
                  )}
                  {item.is_own && (
                    <button
                      onClick={() => handleDelete(item)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: 10, color: UI.deleteBtnColor, padding: '1px 0', lineHeight: 1, marginTop: 2,
                        display: 'block',
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                      onMouseLeave={e => e.currentTarget.style.color = UI.deleteBtnColor}
                    >削除</button>
                  )}
                </div>
                {/* Vote */}
                <button
                  onClick={() => handleVote(item)}
                  title={hasVoted ? '投票済み' : '役に立った'}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                    padding: '6px 10px', borderRadius: 8, flexShrink: 0,
                    border: `1px solid ${hasVoted ? color + '60' : UI.voteBorderIdle}`,
                    background: hasVoted ? `${color}18` : 'transparent',
                    color: hasVoted ? color : UI.voteTextIdle,
                    cursor: hasVoted ? 'default' : 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { if (!hasVoted) { e.currentTarget.style.borderColor = color + '60'; e.currentTarget.style.background = `${color}12`; e.currentTarget.style.color = color } }}
                  onMouseLeave={e => { if (!hasVoted) { e.currentTarget.style.borderColor = UI.voteBorderIdle; e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = UI.voteTextIdle } }}
                >
                  <span style={{ fontSize: 14 }}>▲</span>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{item.votes}</span>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
