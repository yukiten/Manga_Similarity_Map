import { useState, useEffect } from 'react'
import { fetchMangaLists } from '../lib/listsApi'

export default function ListSection({ mangaId, theme = 'light' }) {
  const isL = theme === 'light'
  const border   = isL ? '#e5e7f0' : '#191928'
  const labelCol = isL ? '#6b7280' : '#484890'
  const cardBg   = isL ? '#fff'    : '#0d0d1c'
  const cardBd   = isL ? '#eae8e2' : '#1a1a2e'
  const text     = isL ? '#1f2937' : '#c0c0e0'
  const textSub  = isL ? '#6b7280' : '#9090c0'
  const accent   = isL ? '#4f46e5' : '#818cf8'
  const emptyCol = isL ? '#9ca3af' : '#303050'

  const [lists, setLists]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchMangaLists(mangaId)
      .then(setLists)
      .catch(() => setLists([]))
      .finally(() => setLoading(false))
  }, [mangaId])

  if (!loading && lists.length === 0) return null

  return (
    <div style={{ borderTop: `1px solid ${border}`, paddingTop: 18, marginTop: 4 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: labelCol, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>
        このリストに収録
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: emptyCol, padding: '8px 0' }}>読み込み中…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {lists.map(list => (
            <a
              key={list.id}
              href={`/list/${list.id}`}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9, background: cardBg, border: `1px solid ${cardBd}`, textDecoration: 'none', transition: 'border-color 0.12s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = accent + '66'}
              onMouseLeave={e => e.currentTarget.style.borderColor = cardBd}
            >
              <div style={{ fontSize: 16, flexShrink: 0 }}>📋</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{list.name}</div>
                <div style={{ fontSize: 11, color: textSub, marginTop: 1 }}>
                  <a href={`/user/${list.username}`} style={{ color: accent, textDecoration: 'none', fontWeight: 600 }} onClick={e => e.stopPropagation()}>
                    {list.username}
                  </a>
                  {' '}· {list.item_count}作品
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
