import { useState, useRef, useEffect } from 'react'
import { getTagColor } from '../utils'
import { getTagLabel } from '../tagTranslations'

const HISTORY_KEY = 'manga-search-history'
const HISTORY_MAX = 10

// ── Fuzzy search scoring ──────────────────────────────────────────────────────

// Bigram similarity (Dice coefficient) — used only as TIE-BREAKER / fuzzy supplement
function getBigrams(str) {
  const set = new Set()
  for (let i = 0; i < str.length - 1; i++) set.add(str.slice(i, i + 2))
  return set
}

function bigramSimilarity(a, b) {
  if (!a || !b) return 0
  if (a.length === 1 || b.length === 1) return (a.includes(b) || b.includes(a)) ? 0.5 : 0
  const biA = getBigrams(a)
  const biB = getBigrams(b)
  if (biA.size === 0 || biB.size === 0) return 0
  let common = 0
  for (const bg of biA) if (biB.has(bg)) common++
  return (2 * common) / (biA.size + biB.size)
}

// Score a single title field against the query.
// Exact / prefix / substring matches always win; bigrams handle near-misses.
function scoreTitle(title, lower) {
  if (!title || typeof title !== 'string') return 0
  const t = title.toLowerCase()
  if (t === lower) return 1.0
  if (t.startsWith(lower)) return 0.85 + 0.1 * (lower.length / t.length)
  if (t.includes(lower)) return 0.65 + 0.15 * (lower.length / t.length)
  // Bigram fallback — only used for fuzzy supplement ranking
  return bigramSimilarity(t, lower) * 0.5
}

// スペース区切りで全ワードが含まれるか（AND検索）
function scoreTokens(title, tokens) {
  if (!title || typeof title !== 'string' || tokens.length < 2) return 0
  const t = title.toLowerCase()
  if (tokens.every(tok => t.includes(tok))) {
    // 全トークンがヒット: トークン数が多いほど高スコア
    return 0.6 + 0.05 * Math.min(tokens.length, 4)
  }
  const matched = tokens.filter(tok => t.includes(tok)).length
  if (matched > 0) return 0.3 * (matched / tokens.length)
  return 0
}

// exported so MapApp can also use it for Enter-key search
export function fuzzyScore(item, query) {
  const lower = query.toLowerCase()
  const tokens = lower.split(/\s+/).filter(Boolean)
  const titleScore = Math.max(
    scoreTitle(item.title, lower),
    scoreTitle(item.title_ja, lower),
    scoreTitle(item.title_romaji, lower),
  )
  if (tokens.length >= 2) {
    const tokenScore = Math.max(
      scoreTokens(item.title, tokens),
      scoreTokens(item.title_ja, tokens),
      scoreTokens(item.title_romaji, tokens),
    )
    return Math.max(titleScore, tokenScore)
  }
  return titleScore
}

// Minimum bigram score to include as a fuzzy-only suggestion (not substring match)
const FUZZY_ONLY_THRESHOLD = 0.3

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [] } catch { return [] }
}
function saveHistory(list) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)) } catch {}
}

export default function SearchBar({ mangaData, onSearch, onSelect, variant = 'light', compact = false }) {
  const [query, setQuery]           = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [history, setHistory]       = useState(loadHistory)
  const [focused, setFocused]       = useState(false)
  const inputRef = useRef()
  const preClickFocused = useRef(false)
  const searchTimerRef = useRef(null)
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
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!query.trim()) { setSuggestions([]); return }

    searchTimerRef.current = setTimeout(() => {
      const lower = query.toLowerCase()
      const tokens = lower.split(/\s+/).filter(Boolean)

      const fieldIncludes = (field, q) => field && field.toLowerCase().includes(q)

      // ① substring 判定（タイトル・タグ）+ トークン全一致
      const isSubstring = (m) => {
        if (fieldIncludes(m.title, lower)) return true
        if (fieldIncludes(m.title_ja, lower)) return true
        if (fieldIncludes(m.title_romaji, lower)) return true
        if (tokens.length >= 2) {
          const allIn = (field) => field && tokens.every(tok => field.toLowerCase().includes(tok))
          if (allIn(m.title) || allIn(m.title_ja) || allIn(m.title_romaji)) return true
        }
        return (m.tags || []).some(t =>
          fieldIncludes(t.name, lower) ||
          getTagLabel(t.name).toLowerCase().includes(lower)
        )
      }

      const scored = mangaData.map(m => {
        const sub = isSubstring(m)
        const fuzz = fuzzyScore(m, query)
        return { m, sub, score: sub ? Math.max(fuzz, 0.5) : fuzz }
      })

      // ② substring 一致 OR fuzzy スコアが閾値以上のものを残す
      const results = scored
        .filter(({ sub, score }) => sub || score >= FUZZY_ONLY_THRESHOLD)
        .sort((a, b) => {
          if (a.sub !== b.sub) return a.sub ? -1 : 1
          return b.score - a.score
        })
        .slice(0, 12)
        .map(({ m }) => m)

      setSuggestions(results)
    }, 150)

    return () => clearTimeout(searchTimerRef.current)
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

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      setFocused(false)
      inputRef.current?.blur()
    }
  }

  function handleClick() {
    // onMouseDown で記録したクリック前の状態で判定（onFocus より後に発火するため）
    if (preClickFocused.current && !query.trim() && history.length > 0) {
      setFocused(false)
      inputRef.current?.blur()
    }
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
    <div style={{ position: 'relative' }} role="combobox" aria-expanded={showDropdown} aria-haspopup="listbox" aria-owns="search-listbox">
      <form onSubmit={handleSubmit} role="search" aria-label="作品検索">
        <div style={{
          display: 'flex', alignItems: 'center',
          background: colors.bg,
          border: `${compact ? '1px' : '1.5px'} solid ${focused ? colors.borderActive : colors.border}`,
          borderRadius: compact ? 8 : 14,
          padding: compact ? '0 10px' : '0 16px',
          gap: compact ? 6 : 10,
          boxShadow: focused ? colors.shadowFocus : colors.shadow,
          transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s',
          backdropFilter: 'blur(16px)',
        }}>
          <svg width={compact ? 14 : 18} height={compact ? 14 : 18} viewBox="0 0 24 24" fill="none" stroke={focused ? colors.borderActive : colors.muted} strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onMouseDown={() => { preClickFocused.current = focused }}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 160)}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            placeholder={compact ? 'タイトルで検索…' : 'マンガのタイトルやジャンルで検索…'}
            aria-label="マンガのタイトルやジャンルで検索"
            aria-autocomplete="list"
            aria-controls="search-listbox"
            autoComplete="off"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: colors.text, fontSize: compact ? 12 : 15, padding: compact ? '7px 0' : '14px 0',
              caretColor: colors.borderActive,
              letterSpacing: '0.01em',
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(''); setSuggestions([]) }}
              aria-label="検索をクリア"
              style={{
                background: colors.clearBg, border: `1px solid ${colors.border}`,
                borderRadius: 6, cursor: 'pointer', padding: '3px 7px',
                color: colors.sub, fontSize: 13, lineHeight: 1,
                minWidth: 28, minHeight: 28,
              }}
            >
              ✕
            </button>
          )}
        </div>
      </form>

      {showDropdown && (
        <div id="search-listbox" role="listbox" aria-label="検索結果" style={{
          position: 'absolute', top: compact ? 'calc(100% + 4px)' : 'calc(100% + 8px)', left: 0, right: 0,
          background: colors.dropdownBg,
          border: `${compact ? '1px' : '1.5px'} solid ${colors.dropdownBorder}`,
          borderRadius: compact ? 8 : 14, overflow: 'hidden',
          boxShadow: colors.dropdownShadow,
          backdropFilter: 'blur(20px)',
          zIndex: 300,
        }}>

          {showSuggestions && suggestions.map((manga, idx) => {
            const score = fuzzyScore(manga, query)
            const isFuzzy = score < 0.6
            return (
              <div
                key={manga.id}
                role="option"
                aria-selected={false}
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ fontSize: 14, color: colors.text, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                      {manga.title_ja || manga.title}
                    </div>
                    {isFuzzy && (
                      <span style={{ fontSize: 10, color: colors.muted, background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', borderRadius: 4, padding: '1px 5px', flexShrink: 0, whiteSpace: 'nowrap' }}>近い</span>
                    )}
                  </div>
                  {manga.title_ja && manga.title_ja !== manga.title && (
                    <div style={{ fontSize: 11, color: colors.muted, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {manga.title}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: colors.sub, marginTop: 2 }}>
                    {manga.tags.slice(0, 3).map(t => getTagLabel(t.name)).join(' · ')}
                  </div>
                </div>
              </div>
            )
          })}

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
                  aria-label="検索履歴をすべて削除"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 11, color: colors.muted, padding: '0 2px',
                    minHeight: 44,
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
                  aria-label={`${item.title}を履歴から削除`}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: colors.muted, fontSize: 14, padding: '2px 4px', flexShrink: 0, lineHeight: 1,
                    minWidth: 44, minHeight: 44,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
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
