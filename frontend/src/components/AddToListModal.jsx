import { useState, useEffect } from 'react'
import { fetchMyLists, createList, addToList, removeFromList } from '../lib/listsApi'

export default function AddToListModal({ manga, authToken, theme = 'light', onClose }) {
  const isL = theme === 'light'
  const overlay  = isL ? 'rgba(15,23,42,0.35)'  : 'rgba(0,0,0,0.65)'
  const bg       = isL ? '#faf9f5'              : '#111827'
  const border   = isL ? '#d6dbe8'              : '#1e2535'
  const text     = isL ? '#0f172a'              : '#e2e8f0'
  const textSub  = isL ? '#334155'              : '#9ca3af'
  const textMuted= isL ? '#64748b'              : '#6b7280'
  const inputBg  = isL ? '#fff'                 : '#0d1117'
  const accent   = isL ? '#4f46e5'              : '#818cf8'
  const accentBg = isL ? 'rgba(79,70,229,0.10)' : 'rgba(129,140,248,0.10)'
  const cardBg   = isL ? '#fff'                 : '#0d1117'
  const cardBd   = isL ? '#e5e7eb'              : '#1e2535'
  const addedBg  = isL ? 'rgba(79,70,229,0.08)' : 'rgba(129,140,248,0.08)'

  const [lists, setLists]       = useState([])
  const [added, setAdded]       = useState(new Set()) // list_id set
  const [loading, setLoading]   = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName]   = useState('')
  const [newPub, setNewPub]     = useState(true)
  const [busy, setBusy]         = useState(null) // list_id currently being toggled
  const [error, setError]       = useState('')

  useEffect(() => {
    fetchMyLists(authToken)
      .then(data => {
        setLists(data)
        const inSet = new Set()
        return Promise.all(
          data.map(l =>
            fetch(`/api/lists/${l.id}/items`, {
              headers: { Authorization: `Bearer ${authToken}` },
            })
              .then(r => r.json())
              .then(items => {
                if (Array.isArray(items) && items.some(it => String(it.manga_id) === String(manga.id))) {
                  inSet.add(l.id)
                }
              })
              .catch(() => {})
          )
        ).then(() => setAdded(new Set(inSet)))
      })
      .catch(() => setError('リストの読み込みに失敗しました'))
      .finally(() => setLoading(false))
  }, [authToken, manga.id]) // eslint-disable-line

  async function toggleList(list) {
    setBusy(list.id)
    setError('')
    try {
      if (added.has(list.id)) {
        await removeFromList(authToken, list.id, manga.id)
        setAdded(prev => { const s = new Set(prev); s.delete(list.id); return s })
      } else {
        await addToList(authToken, list.id, manga.id)
        setAdded(prev => new Set([...prev, list.id]))
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    setBusy('new')
    setError('')
    try {
      const list = await createList(authToken, { name, is_public: newPub })
      await addToList(authToken, list.id, manga.id)
      setLists(prev => [list, ...prev])
      setAdded(prev => new Set([...prev, list.id]))
      setNewName('')
      setCreating(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  const inputStyle = {
    flex: 1, padding: '7px 10px', borderRadius: 7,
    border: `1px solid ${border}`, background: inputBg,
    color: text, fontSize: 13, outline: 'none', minWidth: 0,
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: overlay, backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 16, padding: 24, width: '100%', maxWidth: 400, maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 8px 40px rgba(0,0,0,0.3)' }}>

        {/* ヘッダー */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: text }}>リストに追加</div>
            <div style={{ fontSize: 12, color: textMuted, marginTop: 2 }}>{manga.title_ja || manga.title}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: textMuted, fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>

        {/* リスト一覧 */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading ? (
            <div style={{ color: textMuted, fontSize: 13, textAlign: 'center', padding: '16px 0' }}>読み込み中…</div>
          ) : lists.length === 0 ? (
            <div style={{ color: textMuted, fontSize: 13, textAlign: 'center', padding: '16px 0' }}>リストがまだありません</div>
          ) : lists.map(list => {
            const isAdded = added.has(list.id)
            const isBusy  = busy === list.id
            return (
              <div key={list.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: isAdded ? addedBg : cardBg, border: `1px solid ${isAdded ? accent + '44' : cardBd}`, transition: 'all 0.12s' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: isAdded ? accent : text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{list.name}</div>
                  <div style={{ fontSize: 11, color: textMuted }}>{list.item_count}作品 · {list.is_public ? '公開' : '非公開'}</div>
                </div>
                <button
                  onClick={() => toggleList(list)}
                  disabled={isBusy}
                  style={{ flexShrink: 0, padding: '5px 12px', borderRadius: 7, border: `1px solid ${isAdded ? accent + '55' : border}`, background: isAdded ? accentBg : 'transparent', color: isAdded ? accent : textSub, fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: isBusy ? 0.5 : 1 }}
                >{isBusy ? '…' : isAdded ? '✓ 追加済み' : '+ 追加'}</button>
              </div>
            )
          })}
        </div>

        {error && <div style={{ fontSize: 12, color: '#f87171' }}>{error}</div>}

        {/* 新規リスト作成 */}
        {creating ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 10, border: `1px solid ${border}`, background: cardBg }}>
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
              placeholder="リスト名"
              maxLength={100}
              style={inputStyle}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: textSub, cursor: 'pointer' }}>
                <input type="checkbox" checked={newPub} onChange={e => setNewPub(e.target.checked)} />
                公開
              </label>
              <div style={{ flex: 1 }} />
              <button onClick={() => setCreating(false)} style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${border}`, background: 'transparent', color: textMuted, fontSize: 12, cursor: 'pointer' }}>キャンセル</button>
              <button onClick={handleCreate} disabled={!newName.trim() || busy === 'new'} style={{ padding: '5px 12px', borderRadius: 7, border: 'none', background: accent, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: !newName.trim() || busy === 'new' ? 0.5 : 1 }}>作成して追加</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setCreating(true)} style={{ width: '100%', padding: '9px 0', borderRadius: 10, border: `1px dashed ${border}`, background: 'transparent', color: textSub, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            ＋ 新しいリストを作成
          </button>
        )}
      </div>
    </div>
  )
}
