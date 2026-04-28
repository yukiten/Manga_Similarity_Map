import { useState, useRef, useEffect } from 'react'
import { getTagColor } from '../utils'

const HISTORY_KEY = 'manga-search-history'
const HISTORY_MAX = 10

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [] } catch { return [] }
}
function saveHistory(list) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)) } catch {}
}

export default function SearchBar({ mangaData, onSearch, onSelect, variant = 'light' }) {
  const [query, setQuery]           = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [history, setHistory]       = useState(loadHistory)
  const [focused, setFocused]       = useState(false)
  const inputRef = useRef()
  const isDark = variant === 'dark'
  const colors = isDark ? {
    bg: 'rgba(10,10,22,0.94)',
    border: '#252540',
    borderActive: '#6366f1',
    text: '#e8e8f4',
    sub: '#70709a',
    muted: '#50508a',
    shadow: '0 4px 28px rgba(0,0,0,0.5)',
    shadowFocus: '0 0 0 3px rgba(99,102,241,0.18), 0 8px 32px rgba(0,0,0,0.7)',
    dropdownBg: 'rgba(10,10,22,0.98)',
    dropdownBorder: '#252540',
    dropdownShadow: '0 12px 40px rgba(0,0,0,0.7)',
    itemHover: '#181828',
    clearBg: 'rgba(255,255,255,0.07)',
  } : {
    bg: '#faf9f5',
    border: '#e8e6df',
    borderActive: '#4f46e5',
    text: '#1f2937',
    sub: '#5a5868',
    muted: '#8a8880',
    shadow: '0 6px 20px rgba(15,23,42,0.08)',
    shadowFocus: '0 0 0 3px rgba(79,70,229,0.14), 0 10px 26px rgba(15,23,42,0.12)',
    dropdownBg: '#faf9f5',
    dropdownBorder: '#e8e6df',
    dropdownShadow: '0 16px 40px rgba(15,23,42,0.12)',
    itemHover: '#f0eee8',
    clearBg: '#efece6',
  }

  useEffect(() => {
    if (!query.trim()) { setSuggestions([]); return }
    const lower = query.toLowerCase()
    const matches = mangaData
      .filter(m =>
        m.title.toLowerCase().includes(lower) ||
        (m.title_ja     && m.title_ja.includes(query)) ||
        (m.title_romaji && m.title_romaji.toLowerCase().includes(lower)) ||
        m.tags.some(t => t.name?.toLowerCase().includes(lower))
      )
      .slice(0, 8)
    setSuggestions(matches)
  }, [query, mangaData])

  function addToHistory(manga) {
    setHistory(prev => {
      const next = [
        { id: manga.id, title: manga.title, tags: manga.tags?.slice(0, 3) },
        ...prev.filter(h => h.id !== manga.id),
      ].slice(0, HISTORY_MAX)
      saveHistory(next)
      return next
    })
  }

  function removeFromHistory(id, e) {
    e.stopPropagation()
    setHistory(prev => {
      const next = prev.filter(h => h.id !== id)
      saveHistory(next)
      return next
    })
  }

  function clearHistory() {
    setHistory([])
    saveHistory([])
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (suggestions.length > 0) handlePick(suggestions[0])
    else onSearch(query)
  }

  function handlePick(manga) {
    setQuery(manga.title)
    setSuggestions([])
    setFocused(false)
    addToHistory(manga)
    onSelect(manga)
    inputRef.current?.blur()
  }

  function handleHistoryPick(item) {
    const manga = mangaData.find(m => m.id === item.id)
    if (manga) {
      handlePick(manga)
    } else {
      setQuery(item.title)
      onSearch(item.title)
      setFocused(false)
      inputRef.current?.blur()
    }
  }

  const showSuggestions = focused && query.trim() && suggestions.length > 0
  const showHistory     = focused && !query.trim() && history.length > 0
  const showDropdown    = showSuggestions || showHistory

  return (
    <div style={{ position: 'relative' }}>
      <form onSubmit={handleSubmit}>
        <div style={{
          display: 'flex', alignItems: 'center',
          background: colors.bg,
          border: `1.5px solid ${focused ? colors.borderActive : colors.border}`,
          borderRadius: 14,
          padding: '0 16px',
          gap: 10,
          boxShadow: focused ? colors.shadowFocus : colors.shadow,
          transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s',
          backdropFilter: 'blur(16px)',
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={focused ? colors.borderActive : colors.muted} strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 160)}
            placeholder="マンガのタイトルやジャンルで検索…"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: colors.text, fontSize: 15, padding: '14px 0',
              caretColor: colors.borderActive,
              letterSpacing: '0.01em',
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(''); setSuggestions([]) }}
              style={{
                background: colors.clearBg, border: `1px solid ${colors.border}`,
                borderRadius: 6, cursor: 'pointer', padding: '3px 7px',
                color: colors.sub, fontSize: 13, lineHeight: 1,
              }}
            >
              ✕
            </button>
          )}
        </div>
      </form>

      {showDropdown && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0,
          background: colors.dropdownBg,
          border: `1.5px solid ${colors.dropdownBorder}`,
          borderRadius: 14, overflow: 'hidden',
          boxShadow: colors.dropdownShadow,
          backdropFilter: 'blur(20px)',
          zIndex: 300,
        }}>

          {showSuggestions && suggestions.map(manga => (
            <div
              key={manga.id}
              onMouseDown={() => handlePick(manga)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '11px 16px', cursor: 'pointer',
                borderBottom: `1px solid ${colors.border}`,
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = colors.itemHover}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{
                width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                background: getTagColor(manga.tags?.[0]),
                boxShadow: `0 0 8px ${getTagColor(manga.tags?.[0])}aa`,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: colors.text, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {manga.title_ja || manga.title}
                </div>
                {manga.title_ja && manga.title_ja !== manga.title && (
                  <div style={{ fontSize: 11, color: colors.muted, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {manga.title}
                  </div>
                )}
                <div style={{ fontSize: 12, color: colors.sub, marginTop: 2 }}>
                  {manga.tags.slice(0, 3).map(t => t.name).join(' · ')}
                </div>
              </div>
            </div>
          ))}

          {showHistory && (
            <>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '9px 16px 7px',
                borderBottom: `1px solid ${colors.border}`,
              }}>
                <span style={{ fontSize: 11, color: colors.muted, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600 }}>
                  最近の検索
                </span>
                <button
                  onMouseDown={e => { e.preventDefault(); clearHistory() }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 11, color: colors.muted, padding: '0 2px',
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = colors.sub}
                  onMouseLeave={e => e.currentTarget.style.color = colors.muted}
                >
                  すべて削除
                </button>
              </div>

              {history.map(item => (
                <div
                  key={item.id}
                  onMouseDown={() => handleHistoryPick(item)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 16px', cursor: 'pointer',
                  borderBottom: `1px solid ${colors.border}`,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = colors.itemHover}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={colors.muted} strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                </svg>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 14, color: colors.text, fontWeight: 500,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {item.title}
                  </div>
                  {item.tags?.length > 0 && (
                    <div style={{ fontSize: 11, color: colors.sub, marginTop: 2 }}>
                      {item.tags.map(t => t.name).join(' · ')}
                    </div>
                  )}
                </div>

                <button
                  onMouseDown={e => removeFromHistory(item.id, e)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: colors.muted, fontSize: 14, padding: '2px 4px', flexShrink: 0, lineHeight: 1,
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = colors.sub}
                  onMouseLeave={e => e.currentTarget.style.color = colors.muted}
                >
                  ✕
                </button>
              </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
