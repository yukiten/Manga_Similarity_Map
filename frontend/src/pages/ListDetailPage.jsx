import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { fetchList, fetchListItems, removeFromList, updateList, deleteList } from '../lib/listsApi'
import { getCoverUrl } from '../lib/imageSource'
import { updateSeoTags, setCollectionJsonLd, cleanupSeoTags } from '../lib/seo'

function getTheme() { return (localStorage.getItem('theme') || 'light') === 'dark' }

export default function ListDetailPage() {
  const { listId }  = useParams()
  const navigate    = useNavigate()
  const isDark      = getTheme()

  const bg       = isDark ? '#0d1117' : '#f5f4f0'
  const card     = isDark ? '#0f0f1e' : '#ffffff'
  const border   = isDark ? '#1e2535' : '#e5e7f0'
  const text     = isDark ? '#e2e8f0' : '#0f172a'
  const textSub  = isDark ? '#9ca3af' : '#6b7280'
  const accent   = isDark ? '#818cf8' : '#4f46e5'

  const myToken    = localStorage.getItem('manga-map-auth-token')
  const myUsername = localStorage.getItem('manga-map-auth-user')

  const [list, setList]     = useState(null)
  const [items, setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editPub, setEditPub]   = useState(true)

  const isOwner = list && list.username === myUsername

  useEffect(() => {
    Promise.all([
      fetchList(listId, myToken),
      fetchListItems(listId, myToken),
    ])
      .then(([l, its]) => {
        setList(l)
        setItems(its)
        setEditName(l.name)
        setEditDesc(l.description || '')
        setEditPub(l.is_public)
        updateSeoTags({
          title: `${l.name} — ${l.username}のリスト | Media Map`,
          description: l.description
            ? `${l.description.slice(0, 120)} — ${l.username}のリスト`
            : `${l.username}が作成した${l.name}リスト — Media Map`,
        })
        setCollectionJsonLd({ name: l.name, description: l.description, items: its })
      })
      .catch(e => setError(e.message || 'リストを取得できませんでした'))
      .finally(() => setLoading(false))
  }, [listId, myToken]) // eslint-disable-line

  async function handleSave() {
    try {
      const updated = await updateList(myToken, listId, { name: editName, description: editDesc, is_public: editPub })
      setList(updated)
      setEditing(false)
    } catch (e) { alert(e.message) }
  }

  async function handleDelete() {
    if (!window.confirm('このリストを削除しますか？')) return
    try {
      await deleteList(myToken, listId)
      navigate(`/user/${myUsername}`)
    } catch (e) { alert(e.message) }
  }

  async function handleRemoveItem(mangaId) {
    try {
      await removeFromList(myToken, listId, mangaId)
      setItems(prev => prev.filter(it => it.manga_id !== mangaId))
    } catch (e) { alert(e.message) }
  }

  const inputStyle = {
    width: '100%', padding: '8px 10px', borderRadius: 8,
    border: `1px solid ${border}`, background: isDark ? '#0d1117' : '#fff',
    color: text, fontSize: 14, outline: 'none', boxSizing: 'border-box',
  }

  if (loading) return <div style={{ minHeight: '100vh', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: textSub }}>読み込み中…</div>
  if (error)   return <div style={{ minHeight: '100vh', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f87171' }}>{error}</div>

  return (
    <div style={{ minHeight: '100vh', background: bg, color: text }}>

      {/* ── スティッキーナビバー ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: isDark ? 'rgba(13,17,23,0.92)' : 'rgba(245,244,240,0.92)',
        backdropFilter: 'blur(12px)', borderBottom: `1px solid ${border}`,
      }}>
        <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 16px', height: 48, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link
            to="/manga/map"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 12px', borderRadius: 20,
              background: isDark ? 'rgba(129,140,248,0.12)' : 'rgba(79,70,229,0.08)',
              border: `1px solid ${accent}33`,
              color: accent, textDecoration: 'none', fontSize: 13, fontWeight: 700,
            }}
          >
            <span style={{ fontSize: 15 }}>🗺</span> マップ
          </Link>
          <span style={{ color: textSub, fontSize: 13 }}>›</span>
          <Link to={`/user/${list.username}`} style={{ fontSize: 13, color: accent, textDecoration: 'none', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {list.username}
          </Link>
          <span style={{ color: textSub, fontSize: 13 }}>›</span>
          <span style={{ fontSize: 13, color: textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{list.name}</span>
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 16px 48px' }}>

        {/* リストヘッダー */}
        {editing ? (
          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 14, padding: 20, marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="リスト名" maxLength={100} style={inputStyle} />
            <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="説明（任意）" rows={2} maxLength={500} style={{ ...inputStyle, resize: 'vertical' }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: textSub, cursor: 'pointer' }}>
              <input type="checkbox" checked={editPub} onChange={e => setEditPub(e.target.checked)} />
              公開する
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setEditing(false)} style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${border}`, background: 'transparent', color: textSub, cursor: 'pointer', fontSize: 13 }}>キャンセル</button>
              <button onClick={handleSave} disabled={!editName.trim()} style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: accent, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>保存</button>
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{list.name}</h1>
                {list.description && <p style={{ margin: '6px 0 0', fontSize: 13, color: textSub }}>{list.description}</p>}
                <div style={{ marginTop: 6, fontSize: 12, color: textSub }}>
                  <Link to={`/user/${list.username}`} style={{ color: accent, textDecoration: 'none', fontWeight: 600 }}>{list.username}</Link>
                  {' '}· {items.length}作品 · {list.is_public ? '🔓 公開' : '🔒 非公開'}
                </div>
              </div>
              {isOwner && (
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => setEditing(true)} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${border}`, background: 'transparent', color: textSub, cursor: 'pointer', fontSize: 12 }}>編集</button>
                  <button onClick={handleDelete} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid #f8717144`, background: 'transparent', color: '#f87171', cursor: 'pointer', fontSize: 12 }}>削除</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 作品グリッド */}
        {items.length === 0 ? (
          <div style={{ color: textSub, textAlign: 'center', padding: '40px 0', fontSize: 14 }}>作品がありません</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 12 }}>
            {items.map(item => {
              const coverUrl = item.cover || getCoverUrl(item)
              return (
                <div key={item.manga_id} style={{ position: 'relative' }}>
                  <Link to={`/manga/${item.slug || item.manga_id}`} style={{ textDecoration: 'none' }}>
                    <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden', transition: 'transform 0.12s' }}
                      onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.03)'}
                      onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                    >
                      <div style={{ paddingTop: '140%', position: 'relative', background: isDark ? '#1e2535' : '#eae8e2' }}>
                        {coverUrl && <img src={coverUrl} alt={item.title_ja || item.title} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />}
                      </div>
                      <div style={{ padding: '6px 8px' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: text, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          {item.title_ja || item.title}
                        </div>
                      </div>
                    </div>
                  </Link>
                  {isOwner && (
                    <button onClick={() => handleRemoveItem(item.manga_id)} title="リストから削除" style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>✕</button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
