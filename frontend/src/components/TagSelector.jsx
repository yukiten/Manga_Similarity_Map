import { useEffect, useMemo, useRef, useState } from 'react'
import { getTagLabel, tagMatchesSearch } from '../tagTranslations'

export default function TagSelector({ tagList, selectedTags, onToggleTag, onClearTags, matchCount, totalCount, variant = 'light', panelStrategy = 'absolute', filterMode = 'OR', onFilterModeChange }) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const rootRef   = useRef(null)
  const buttonRef = useRef(null)
  const [fixedPanel, setFixedPanel] = useState(null)
  const isDark = variant === 'dark'

  useEffect(() => {
    if (!open) return
    const onDown = e => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (!open || panelStrategy !== 'fixed') return

    const update = () => {
      const r = buttonRef.current?.getBoundingClientRect()
      if (!r) return

      const margin = 10
      const width = Math.min(420, Math.max(r.width, 320))
      let left = r.left
      left = Math.min(Math.max(margin, left), window.innerWidth - width - margin)

      const top = r.bottom + 8
      const maxHeight = Math.min(480, Math.max(220, window.innerHeight - top - margin))

      setFixedPanel({ top, left, width, maxHeight })
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, panelStrategy])
  const colors = isDark ? {
    bg: 'rgba(10,10,22,0.94)',
    border: '#252540',
    accent: '#6366f1',
    accentBg: 'rgba(99,102,241,0.18)',
    accentBorder: '#6366f1',
    text: '#c0c0d8',
    sub: '#50508a',
    muted: '#40407a',
    shadow: '0 4px 20px rgba(0,0,0,0.5)',
    shadowOpen: '0 16px 50px rgba(0,0,0,0.8)',
    panelBg: 'rgba(10,10,22,0.98)',
    rowHover: 'rgba(255,255,255,0.04)',
  } : {
    bg: '#faf9f5',
    border: '#e8e6df',
    accent: '#4f46e5',
    accentBg: 'rgba(79,70,229,0.14)',
    accentBorder: 'rgba(79,70,229,0.45)',
    text: '#1f2937',
    sub: '#5a5868',
    muted: '#8a8880',
    shadow: '0 6px 20px rgba(15,23,42,0.08)',
    shadowOpen: '0 16px 40px rgba(15,23,42,0.14)',
    panelBg: '#faf9f5',
    rowHover: '#f0eee8',
  }

  const filtered = useMemo(() => {
    if (!tagList) return []
    const lower = search.trim().toLowerCase()
    const list  = lower ? tagList.filter(t => tagMatchesSearch(t.name, lower)) : tagList
    return list.slice(0, 60)
  }, [tagList, search])

  const hasFilter = selectedTags.length > 0

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>

      {/* Toggle button */}
      <button
        ref={buttonRef}
        onClick={() => setOpen(o => !o)}
        style={{
          background: open || hasFilter ? colors.accentBg : colors.bg,
          border: `1px solid ${open || hasFilter ? colors.accentBorder : colors.border}`,
          borderRadius: 8,
          color: open || hasFilter ? colors.accent : colors.sub,
          padding: '6px 10px',
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 600,
          backdropFilter: 'blur(16px)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          transition: 'all 0.2s',
          width: '100%',
          justifyContent: 'space-between',
          boxShadow: open || hasFilter
            ? colors.shadowOpen
            : colors.shadow,
          letterSpacing: '0.01em',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
          </svg>
          タグで絞り込む
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {hasFilter && (
            <span style={{
              background: colors.accent, color: '#fff',
              borderRadius: 20, padding: '1px 7px',
              fontSize: 10, fontWeight: 700, letterSpacing: '0.02em',
            }}>
              {selectedTags.length}
            </span>
          )}
          <span style={{ fontSize: 9, opacity: 0.45 }}>{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Panel */}
      {open && (panelStrategy !== 'fixed' || fixedPanel) && (
        <div style={{
          position: panelStrategy === 'fixed' ? 'fixed' : 'absolute',
          top: panelStrategy === 'fixed'
            ? (fixedPanel?.top ?? 0)
            : 'calc(100% + 8px)',
          left: panelStrategy === 'fixed'
            ? (fixedPanel?.left ?? 0)
            : 0,
          right: panelStrategy === 'fixed' ? 'auto' : 0,
          width: panelStrategy === 'fixed'
            ? (fixedPanel?.width ?? 'auto')
            : undefined,
          background: colors.panelBg,
          border: `1.5px solid ${colors.border}`,
          borderRadius: 16,
          boxShadow: colors.shadowOpen,
          backdropFilter: 'blur(20px)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: panelStrategy === 'fixed'
            ? (fixedPanel?.maxHeight ?? 480)
            : 480,
          zIndex: panelStrategy === 'fixed' ? 1000 : 200,
        }}>

          {/* Header */}
          <div style={{ padding: '14px 16px', borderBottom: `1px solid ${colors.border}` }}>

            {/* OR / AND toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 11, color: colors.muted, flexShrink: 0 }}>絞り込み方式:</span>
              <div style={{ display: 'flex', gap: 3 }}>
                {['OR', 'AND'].map(mode => {
                  const active = filterMode === mode
                  return (
                    <button
                      key={mode}
                      onClick={() => onFilterModeChange?.(mode)}
                      style={{
                        padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                        background: active ? colors.accentBg : 'transparent',
                        border: `1px solid ${active ? colors.accentBorder : colors.border}`,
                        color: active ? colors.accent : colors.muted,
                        cursor: 'pointer', transition: 'all 0.12s',
                      }}
                    >{mode}</button>
                  )
                })}
              </div>
            </div>

            {/* Hit count */}
            <div style={{ fontSize: 12, color: colors.sub, marginBottom: 10, letterSpacing: '0.05em' }}>
              {hasFilter
                ? <span style={{ color: colors.accent, fontWeight: 600 }}>{matchCount.toLocaleString()} 件ヒット <span style={{ color: colors.muted }}>/ {totalCount.toLocaleString()} 件中</span></span>
                : <span>タグを選択してマップを絞り込む</span>
              }
            </div>

            {/* Selected chips */}
            {hasFilter && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {selectedTags.map(name => (
                  <span
                    key={name}
                    onClick={() => onToggleTag(name)}
                    style={{
                      background: colors.accentBg,
                      border: `1px solid ${colors.accentBorder}`,
                      borderRadius: 20,
                      padding: '4px 12px',
                      fontSize: 13,
                      color: colors.accent,
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 6,
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(99,102,241,0.35)' : 'rgba(109,106,248,0.2)'}
                    onMouseLeave={e => e.currentTarget.style.background = colors.accentBg}
                  >
                    {getTagLabel(name)} <span style={{ opacity: 0.55, fontSize: 11 }}>✕</span>
                  </span>
                ))}
                <span
                  onClick={onClearTags}
                  style={{ fontSize: 12, color: colors.muted, cursor: 'pointer', alignSelf: 'center', textDecoration: 'underline', paddingLeft: 4 }}
                  onMouseEnter={e => e.currentTarget.style.color = colors.sub}
                  onMouseLeave={e => e.currentTarget.style.color = colors.muted}
                >
                  すべて解除
                </span>
              </div>
            )}

            {/* Search input */}
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="タグを検索…"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: isDark ? 'rgba(255,255,255,0.05)' : '#f7f9fc',
                border: `1.5px solid ${colors.border}`,
                borderRadius: 10,
                padding: '10px 14px',
                color: colors.text, fontSize: 14, outline: 'none',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => e.target.style.borderColor = colors.accent}
              onBlur={e => e.target.style.borderColor = colors.border}
            />
          </div>

          {/* Tag list */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.map(tag => {
              const active = selectedTags.includes(tag.name)
              return (
                <div
                  key={tag.name}
                  onClick={() => onToggleTag(tag.name)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 18px', cursor: 'pointer',
                    background: active ? colors.accentBg : 'transparent',
                    borderLeft: `3px solid ${active ? colors.accent : 'transparent'}`,
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = colors.rowHover }}
                  onMouseLeave={e => { e.currentTarget.style.background = active ? colors.accentBg : 'transparent' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {active && (
                      <span style={{ color: colors.accent, fontSize: 13, lineHeight: 1 }}>✓</span>
                    )}
                    <span style={{ fontSize: 14, color: active ? colors.accent : colors.text, fontWeight: active ? 600 : 500 }}>
                      {getTagLabel(tag.name)}
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: colors.muted, fontVariantNumeric: 'tabular-nums' }}>
                    {tag.count.toLocaleString()}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
