import { useState, useEffect } from 'react'
import { getTagColorVivid } from '../utils'
import { getTagLabel } from '../tagTranslations'

// コミュニティ追加タグの投票済みフラグ（community_ キーのみ）を localStorage から読み書き
const VOTED_STORAGE_KEY = 'community-tag-votes-v2'

function loadAllVoted() {
  try { return JSON.parse(localStorage.getItem(VOTED_STORAGE_KEY)) || {} } catch { return {} }
}
function saveAllVoted(obj) {
  try { localStorage.setItem(VOTED_STORAGE_KEY, JSON.stringify(obj)) } catch {}
}

// ── Sub-components ────────────────────────────────────────────────────────────

function VoteButton({ direction, active, disabled, onClick, tagName }) {
  const isUp = direction === 'up'
  const activeColor = isUp ? '#22c55e' : '#ef4444'
  const label = isUp ? '↑' : '↓'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={`${tagName || 'タグ'}を${isUp ? '賛成' : '反対'}票`}
      aria-pressed={active}
      style={{
        background: active ? `rgba(${isUp ? '34,197,94' : '239,68,68'},0.25)` : `rgba(${isUp ? '34,197,94' : '239,68,68'},0.07)`,
        border: `1px solid ${active ? activeColor : activeColor + '33'}`,
        borderRadius: 6, color: activeColor,
        cursor: disabled ? 'default' : 'pointer',
        width: 44, height: 44, fontSize: 13,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: disabled && !active ? 0.35 : 1,
        transition: 'background 0.12s, border-color 0.12s',
        flexShrink: 0,
      }}
    >{label}</button>
  )
}

function getUI(theme) {
  const isDark = theme === 'dark'
  return {
    borderTop:      isDark ? '#191928'              : '#e5e7f0',
    labelColor:     isDark ? '#404070'              : '#6b7280',
    noteColor:      isDark ? '#2e2e58'              : '#9ca3af',
    loadingColor:   isDark ? '#404070'              : '#9ca3af',
    rowBg:          isDark ? '#0f0f1e'              : 'rgba(99,102,241,0.04)',
    netZero:        isDark ? '#40406a'              : '#9ca3af',
    communityText:  isDark ? '#363660'              : '#6366f1',
    communityBg:    isDark ? 'rgba(99,102,241,0.10)': 'rgba(99,102,241,0.08)',
    communityBorder:isDark ? 'rgba(99,102,241,0.20)': 'rgba(99,102,241,0.30)',
    inputBg:        isDark ? '#0d0d1e'              : '#ffffff',
    inputBorder:    isDark ? '#252545'              : '#d1d5db',
    inputText:      isDark ? '#cccce8'              : '#374151',
    inputFocus:     '#6366f1',
    btnBg:          'rgba(99,102,241,0.18)',
    btnBorder:      'rgba(99,102,241,0.40)',
    btnText:        '#818cf8',
  }
}

function TagRow({ name, net, voted, onVoteUp, onVoteDown, isCommunity = false, strength, theme = 'dark' }) {
  const color = getTagColorVivid(name, theme)
  const UI = getUI(theme)
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 10px',
      background: UI.rowBg, borderRadius: 9,
      border: isCommunity ? `1.5px dashed ${color}44` : `1px solid ${color}1a`,
    }}>
      <span style={{
        flex: 1, fontSize: 12, fontWeight: 600,
        color: color + 'cc',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {getTagLabel(name)}
      </span>
      {isCommunity && (
        <span style={{
          fontSize: 9, color: UI.communityText, letterSpacing: '0.07em',
          background: UI.communityBg, border: `1px solid ${UI.communityBorder}`,
          borderRadius: 4, padding: '1px 6px', flexShrink: 0, fontWeight: 600,
        }}>COMMUNITY</span>
      )}
      {isCommunity && strength != null && (
        <span style={{
          fontSize: 10, color: strength >= 70 ? '#22c55e99' : strength >= 40 ? '#eab30899' : '#ef444499',
          flexShrink: 0, fontWeight: 600,
        }}>{strength}%</span>
      )}
      <span style={{
        fontSize: 11, minWidth: 32, textAlign: 'right', flexShrink: 0,
        color: net > 0 ? '#22c55e99' : net < 0 ? '#ef444499' : UI.netZero,
        fontWeight: 700,
      }}>
        {net > 0 ? '+' : ''}{net}
      </span>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} role="group" aria-label={`${name}の投票`}>
        <VoteButton direction="up"   active={voted === 'up'}   disabled={!!voted} onClick={onVoteUp}   tagName={name} />
        <VoteButton direction="down" active={voted === 'down'} disabled={!!voted} onClick={onVoteDown} tagName={name} />
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CommunityTagSection({
  mangaId,
  theme = 'dark',
  onDataChange,   // (newData) => void — MapApp の communityData を即時同期するコールバック
}) {
  const [data, setData]         = useState({ community_tags: [], default_tag_votes: {} })
  const [loading, setLoading]   = useState(false)
  const [fetchError, setFetchError] = useState(null)
  const [newTag, setNewTag]     = useState('')
  const [newStrength, setNewStrength] = useState(50)
  const [adding, setAdding]     = useState(false)
  const [addError, setAddError] = useState(null)

  // 投票済み状態（community_ キーのみ管理）
  const [allVoted, setAllVoted] = useState(loadAllVoted)
  const mangaVoted = allVoted[mangaId] || {}

  function markVoted(key, direction) {
    setAllVoted(prev => {
      const next = { ...prev, [mangaId]: { ...(prev[mangaId] || {}), [key]: direction } }
      saveAllVoted(next)
      return next
    })
  }
  function unmarkVoted(key) {
    setAllVoted(prev => {
      const mg = { ...(prev[mangaId] || {}) }
      delete mg[key]
      const next = { ...prev, [mangaId]: mg }
      saveAllVoted(next)
      return next
    })
  }

  // mangaId が変わったらデータを再取得
  useEffect(() => {
    if (!mangaId) return
    setLoading(true)
    setFetchError(null)
    fetch(`/api/manga/${encodeURIComponent(mangaId)}/community-tags`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json() })
      .then(d => { setData(d); onDataChange?.(d); setLoading(false) })
      .catch(() => { setLoading(false); setFetchError('データの取得に失敗しました') })
  }, [mangaId]) // eslint-disable-line

  // ── コミュニティタグ投票 ─────────────────────────────────────────────────────
  function voteCommunity(tagName, delta) {
    const key = `community_${tagName}`
    if (mangaVoted[key]) return

    markVoted(key, delta > 0 ? 'up' : 'down')
    const prevData = data

    const updated = {
      ...data,
      community_tags: data.community_tags.map(t =>
        t.tag_name === tagName
          ? { ...t, upvotes: t.upvotes + (delta > 0 ? 1 : 0), downvotes: t.downvotes + (delta < 0 ? 1 : 0) }
          : t
      ),
    }
    setData(updated)
    onDataChange?.(updated)

    fetch(`/api/manga/${encodeURIComponent(mangaId)}/community-tags/${encodeURIComponent(tagName)}/vote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta }),
    })
      .then(r => { if (!r.ok) throw new Error() })
      .catch(() => {
        unmarkVoted(key)
        setData(prevData)
        onDataChange?.(prevData)
      })
  }

  // ── タグ追加 ────────────────────────────────────────────────────────────────
  async function handleAddTag(e) {
    e.preventDefault()
    const name = newTag.trim()
    if (!name || adding) return
    setAdding(true)
    setAddError(null)
    try {
      const r = await fetch(`/api/manga/${encodeURIComponent(mangaId)}/community-tags`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag_name: name, strength: newStrength }),
      })
      const json = await r.json()
      if (!r.ok) { setAddError(json.detail || 'エラーが発生しました'); setAdding(false); return }
      const updated = {
        ...data,
        community_tags: [
          ...data.community_tags.filter(t => t.tag_name !== json.tag_name),
          json,
        ],
      }
      setData(updated)
      onDataChange?.(updated)
      setNewTag('')
      setNewStrength(50)
    } catch {
      setAddError('通信エラーが発生しました')
    }
    setAdding(false)
  }

  const UI = getUI(theme)

  return (
    <div style={{ padding: '18px 22px 22px', borderTop: `1px solid ${UI.borderTop}` }}>

      {loading && (
        <div style={{ fontSize: 12, color: UI.loadingColor, padding: '8px 0' }}>読み込み中…</div>
      )}

      {fetchError && (
        <div style={{ fontSize: 12, color: '#ef4444', padding: '8px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>⚠</span>{fetchError}
          <button
            onClick={() => {
              setFetchError(null); setLoading(true)
              fetch(`/api/manga/${encodeURIComponent(mangaId)}/community-tags`)
                .then(r => { if (!r.ok) throw new Error(); return r.json() })
                .then(d => { setData(d); onDataChange?.(d); setLoading(false) })
                .catch(() => { setLoading(false); setFetchError('データの取得に失敗しました') })
            }}
            style={{ marginLeft: 4, background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', fontSize: 11, textDecoration: 'underline' }}
          >再試行</button>
        </div>
      )}

      {/* コミュニティ追加タグ */}
      {!loading && !fetchError && data.community_tags.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 10, color: UI.labelColor, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8, fontWeight: 600 }}>
            コミュニティ追加タグ
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {data.community_tags.map(tag => {
              const net   = tag.upvotes - tag.downvotes
              const voted = mangaVoted[`community_${tag.tag_name}`]
              return (
                <TagRow
                  key={tag.tag_name}
                  name={tag.tag_name}
                  net={net}
                  voted={voted}
                  onVoteUp={() => voteCommunity(tag.tag_name, 1)}
                  onVoteDown={() => voteCommunity(tag.tag_name, -1)}
                  isCommunity
                  strength={tag.strength}
                  theme={theme}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* タグ追加フォーム */}
      <div>
        <div style={{ fontSize: 10, color: UI.labelColor, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8, fontWeight: 600 }}>
          タグを追加する
        </div>
        <form onSubmit={handleAddTag} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={newTag}
              onChange={e => { setNewTag(e.target.value); setAddError(null) }}
              placeholder="例: Isekai, Time Travel…"
              maxLength={50}
              style={{
                flex: 1, padding: '8px 12px',
                background: UI.inputBg,
                border: `1px solid ${addError ? '#ef4444' : UI.inputBorder}`,
                borderRadius: 9, color: UI.inputText, fontSize: 13,
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => e.target.style.borderColor = UI.inputFocus}
              onBlur={e => e.target.style.borderColor = addError ? '#ef4444' : UI.inputBorder}
            />
            <button
              type="submit"
              disabled={adding || !newTag.trim()}
              style={{
                background: UI.btnBg,
                border: `1px solid ${UI.btnBorder}`,
                borderRadius: 9, color: UI.btnText,
                cursor: adding || !newTag.trim() ? 'default' : 'pointer',
                padding: '8px 16px', fontSize: 13, fontWeight: 600, flexShrink: 0,
                opacity: adding || !newTag.trim() ? 0.45 : 1,
                transition: 'opacity 0.15s',
              }}
            >追加</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: UI.noteColor, flexShrink: 0 }}>適合度</span>
            <input
              type="range"
              min={20} max={100} step={5}
              value={newStrength}
              onChange={e => setNewStrength(Number(e.target.value))}
              style={{ flex: 1, accentColor: '#6366f1', height: 4, cursor: 'pointer' }}
            />
            <span style={{
              fontSize: 12, fontWeight: 700, minWidth: 36, textAlign: 'right',
              color: newStrength >= 70 ? '#22c55e' : newStrength >= 40 ? '#eab308' : '#ef4444',
            }}>{newStrength}%</span>
          </div>
        </form>
        {addError && (
          <div style={{ marginTop: 6, fontSize: 11, color: '#ef4444' }}>{addError}</div>
        )}
      </div>
    </div>
  )
}
