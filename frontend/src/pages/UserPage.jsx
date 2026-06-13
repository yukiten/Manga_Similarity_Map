import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { fetchUserLists, fetchMyLists, deleteList } from '../lib/listsApi'
import { updateSeoTags, cleanupSeoTags } from '../lib/seo'

// ── テーマ取得 ─────────────────────────────────────────────────────────────────
function useTheme() {
  const [isDark, setIsDark] = useState(() => localStorage.getItem('manga-map-theme') === 'dark')
  useEffect(() => {
    const handler = () => setIsDark(localStorage.getItem('manga-map-theme') === 'dark')
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])
  return isDark
}

// ── APIフェッチ ────────────────────────────────────────────────────────────────
async function fetchUserReviews(username) {
  const r = await fetch(`/api/users/${encodeURIComponent(username)}/reviews`)
  if (!r.ok) throw new Error()
  return r.json()
}
async function fetchUserNextReads(username) {
  const r = await fetch(`/api/users/${encodeURIComponent(username)}/next-reads`)
  if (!r.ok) throw new Error()
  return r.json()
}

// ── 星評価表示 ─────────────────────────────────────────────────────────────────
function Stars({ rating, color }) {
  return (
    <span style={{ fontSize: 13, letterSpacing: 1 }}>
      {[1,2,3,4,5].map(n => (
        <span key={n} style={{ color: n <= rating ? color : '#d1d5db' }}>★</span>
      ))}
    </span>
  )
}

// ── タブボタン ─────────────────────────────────────────────────────────────────
function Tab({ label, count, active, onClick, accent, textSub, border }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '10px 20px', border: 'none', background: 'transparent',
        borderBottom: `2px solid ${active ? accent : 'transparent'}`,
        color: active ? accent : textSub,
        fontWeight: active ? 700 : 500, fontSize: 14, cursor: 'pointer',
        transition: 'all 0.15s', whiteSpace: 'nowrap',
      }}
    >
      {label}
      {count != null && (
        <span style={{
          marginLeft: 6, fontSize: 11, fontWeight: 700,
          padding: '1px 6px', borderRadius: 10,
          background: active ? accent + '20' : 'transparent',
          color: active ? accent : textSub,
        }}>{count}</span>
      )}
    </button>
  )
}

// ── メインコンポーネント ───────────────────────────────────────────────────────
export default function UserPage() {
  const { username } = useParams()
  const isDark = useTheme()

  const bg       = isDark ? '#0d1117'  : '#f5f4f0'
  const surface  = isDark ? '#0f0f1e'  : '#ffffff'
  const border   = isDark ? '#1e2535'  : '#e5e7f0'
  const text     = isDark ? '#e2e8f0'  : '#0f172a'
  const textSub  = isDark ? '#9ca3af'  : '#6b7280'
  const accent   = isDark ? '#818cf8'  : '#4f46e5'
  const accentBg = isDark ? 'rgba(129,140,248,0.10)' : 'rgba(79,70,229,0.08)'
  const starCol  = isDark ? '#fbbf24'  : '#d97706'

  const myToken    = localStorage.getItem('manga-map-auth-token')
  const myUsername = localStorage.getItem('manga-map-auth-user')
  const isMe       = myUsername === username

  const [tab, setTab]           = useState('lists')
  const [lists, setLists]       = useState([])
  const [reviews, setReviews]   = useState([])
  const [nextReads, setNextReads] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')

  useEffect(() => {
    updateSeoTags({
      title: `${username} | Media Map`,
      description: `${username}のレビュー・リスト・次に読みたい作品一覧 — Media Map`,
    })
    setLoading(true)
    setError('')
    Promise.all([
      (isMe && myToken ? fetchMyLists(myToken) : fetchUserLists(username)).catch(() => []),
      fetchUserReviews(username).catch(() => []),
      fetchUserNextReads(username).catch(() => []),
    ]).then(([l, r, n]) => {
      setLists(l)
      setReviews(r)
      setNextReads(n)
    }).catch(() => setError('ユーザーが見つかりません'))
      .finally(() => setLoading(false))
  }, [username]) // eslint-disable-line

  async function handleDeleteList(listId) {
    if (!window.confirm('このリストを削除しますか？')) return
    try {
      await deleteList(myToken, listId)
      setLists(prev => prev.filter(l => l.id !== listId))
    } catch (e) { alert(e.message) }
  }

  const cardStyle = {
    background: surface, border: `1px solid ${border}`,
    borderRadius: 14, overflow: 'hidden',
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: textSub }}>
      読み込み中…
    </div>
  )

  if (error) return (
    <div style={{ minHeight: '100vh', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f87171' }}>
      {error}
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: bg, color: text }}>

      {/* ── スティッキーナビバー ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: isDark ? 'rgba(13,17,23,0.92)' : 'rgba(245,244,240,0.92)',
        backdropFilter: 'blur(12px)', borderBottom: `1px solid ${border}`,
      }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 16px', height: 48, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link
            to="/manga/map"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 12px', borderRadius: 20,
              background: isDark ? 'rgba(129,140,248,0.12)' : 'rgba(79,70,229,0.08)',
              border: `1px solid ${accent}33`,
              color: accent, textDecoration: 'none', fontSize: 13, fontWeight: 700,
              transition: 'background 0.15s',
            }}
          >
            <span style={{ fontSize: 15 }}>🗺</span> マップ
          </Link>
          <div style={{ flex: 1, fontSize: 13, color: textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {username}のページ
          </div>
        </div>
      </div>

      {/* ── プロフィールヘッダー ── */}
      <div style={{ background: surface, borderBottom: `1px solid ${border}` }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '28px 20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
            {/* アバター */}
            <div style={{
              width: 64, height: 64, borderRadius: '50%', flexShrink: 0,
              background: `linear-gradient(135deg, ${accent}88, ${accent}22)`,
              border: `2px solid ${accent}44`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 26, fontWeight: 800, color: accent,
            }}>
              {username[0]?.toUpperCase()}
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{username}</h1>
              <div style={{ display: 'flex', gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
                {[
                  ['リスト', lists.filter(l => l.is_public || isMe).length],
                  ['レビュー', reviews.length],
                  ['おすすめ投稿', nextReads.length],
                ].map(([label, count]) => (
                  <div key={label} style={{ fontSize: 13, color: textSub }}>
                    <span style={{ fontWeight: 700, color: text }}>{count}</span> {label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* タブ */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${border}`, gap: 0, overflowX: 'auto' }}>
            <Tab label="リスト"         count={lists.filter(l => l.is_public || isMe).length} active={tab === 'lists'}     onClick={() => setTab('lists')}     accent={accent} textSub={textSub} border={border} />
            <Tab label="レビュー"       count={reviews.length}    active={tab === 'reviews'}   onClick={() => setTab('reviews')}   accent={accent} textSub={textSub} border={border} />
            <Tab label="おすすめ類似"   count={nextReads.length}  active={tab === 'nextreads'} onClick={() => setTab('nextreads')} accent={accent} textSub={textSub} border={border} />
          </div>
        </div>
      </div>

      {/* ── コンテンツ ── */}
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 20px 64px' }}>

        {/* ━━ リストタブ ━━ */}
        {tab === 'lists' && (
          lists.filter(l => l.is_public || isMe).length === 0 ? (
            <Empty text={isMe ? 'リストがまだありません。作品詳細ページから作成できます。' : '公開リストがありません'} color={textSub} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {lists.filter(l => l.is_public || isMe).map(list => (
                <div key={list.id} style={cardStyle}>
                  {list.preview_covers?.length > 0 && (
                    <div style={{ display: 'flex', height: 80 }}>
                      {list.preview_covers.slice(0, 4).map((cover, i) => (
                        <div key={i} style={{ flex: 1, overflow: 'hidden', background: isDark ? '#1e2535' : '#e8e6e0' }}>
                          <img src={cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} loading="lazy" />
                        </div>
                      ))}
                      {Array.from({ length: Math.max(0, 4 - list.preview_covers.length) }).map((_, i) => (
                        <div key={i} style={{ flex: 1, background: isDark ? '#0d1117' : '#f0eeea' }} />
                      ))}
                    </div>
                  )}
                  <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Link to={`/list/${list.id}`} style={{ fontSize: 15, fontWeight: 700, color: text, textDecoration: 'none' }}>
                        {list.name}
                      </Link>
                      {list.description && (
                        <div style={{ fontSize: 12, color: textSub, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{list.description}</div>
                      )}
                      <div style={{ fontSize: 11, color: textSub, marginTop: 3 }}>
                        {list.item_count}作品 · {list.is_public ? '🔓 公開' : '🔒 非公開'}
                      </div>
                    </div>
                    {isMe && (
                      <button onClick={() => handleDeleteList(list.id)} style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${border}`, background: 'transparent', color: '#f87171', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>削除</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* ━━ レビュータブ ━━ */}
        {tab === 'reviews' && (
          reviews.length === 0 ? (
            <Empty text="まだレビューを投稿していません" color={textSub} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {reviews.map(r => (
                <div key={r.id} style={cardStyle}>
                  <div style={{ display: 'flex', gap: 0 }}>
                    {/* 作品カバー */}
                    <Link to={`/manga/${r.slug || r.manga_id}`} style={{ flexShrink: 0, display: 'block', width: 72, background: isDark ? '#1e2535' : '#e8e6e0', textDecoration: 'none' }}>
                      {r.cover
                        ? <img src={r.cover} alt={r.title_ja || r.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', minHeight: 100 }} loading="lazy" />
                        : <div style={{ width: 72, height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', color: textSub, fontSize: 24 }}>📖</div>
                      }
                    </Link>
                    {/* テキスト */}
                    <div style={{ flex: 1, padding: '14px 16px', minWidth: 0 }}>
                      <Link to={`/manga/${r.slug || r.manga_id}`} style={{ fontSize: 14, fontWeight: 700, color: text, textDecoration: 'none', display: 'block', marginBottom: 4 }}>
                        {r.title_ja || r.title}
                      </Link>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <Stars rating={r.rating} color={starCol} />
                        <span style={{ fontSize: 11, color: textSub }}>{r.created_at?.slice(0, 10)}</span>
                      </div>
                      <p style={{ margin: 0, fontSize: 13, color: textSub, lineHeight: 1.7, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                        {r.body}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* ━━ おすすめ類似タブ ━━ */}
        {tab === 'nextreads' && (
          nextReads.length === 0 ? (
            <Empty text="まだおすすめ類似作品を投稿していません" color={textSub} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {nextReads.map(nr => (
                <div key={nr.id} style={cardStyle}>
                  <div style={{ padding: '14px 16px' }}>
                    {/* 元作品 → 推薦先 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: nr.comment ? 10 : 0 }}>
                      <MangaChip manga={{ slug: nr.from_slug, id: nr.from_id, title: nr.from_title, title_ja: nr.from_title_ja, cover: nr.from_cover }} text={text} textSub={textSub} border={border} isDark={isDark} />
                      <div style={{ color: accent, fontSize: 18, flexShrink: 0 }}>→</div>
                      <MangaChip manga={{ slug: nr.to_slug, id: nr.to_id, title: nr.to_title, title_ja: nr.to_title_ja, cover: nr.to_cover }} text={text} textSub={textSub} border={border} isDark={isDark} />
                      <div style={{ flex: 1 }} />
                      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: textSub }}>
                        <span style={{ color: accent }}>▲</span>{nr.votes}
                      </div>
                    </div>
                    {nr.comment && (
                      <p style={{ margin: 0, fontSize: 13, color: textSub, lineHeight: 1.7, paddingTop: 2 }}>{nr.comment}</p>
                    )}
                    <div style={{ fontSize: 11, color: textSub, marginTop: 6 }}>{nr.created_at?.slice(0, 10)}</div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}

// ── サブコンポーネント ─────────────────────────────────────────────────────────

function Empty({ text, color }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 0', color, fontSize: 14 }}>{text}</div>
  )
}

function MangaChip({ manga, text, textSub, border, isDark }) {
  return (
    <Link
      to={`/manga/${manga.slug || manga.id}`}
      style={{ display: 'flex', alignItems: 'center', gap: 7, textDecoration: 'none', minWidth: 0, flex: 1 }}
    >
      <div style={{ width: 36, height: 50, flexShrink: 0, borderRadius: 4, overflow: 'hidden', background: isDark ? '#1e2535' : '#e8e6e0', border: `1px solid ${border}` }}>
        {manga.cover && <img src={manga.cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} loading="lazy" />}
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: text, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.4 }}>
        {manga.title_ja || manga.title}
      </span>
    </Link>
  )
}
