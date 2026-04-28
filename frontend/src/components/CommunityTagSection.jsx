import { useState, useEffect } from 'react'
import { getTagColor } from '../utils'

function VoteButton({ direction, active, disabled, onClick }) {
  const isUp = direction === 'up'
  const activeColor = isUp ? '#22c55e' : '#ef4444'
  const label = isUp ? '↑' : '↓'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: active ? `rgba(${isUp ? '34,197,94' : '239,68,68'},0.25)` : `rgba(${isUp ? '34,197,94' : '239,68,68'},0.07)`,
        border: `1px solid ${active ? activeColor : activeColor + '33'}`,
        borderRadius: 6, color: activeColor,
        cursor: disabled ? 'default' : 'pointer',
        width: 28, height: 26, fontSize: 13,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: disabled && !active ? 0.35 : 1,
        transition: 'background 0.12s, border-color 0.12s',
        flexShrink: 0,
      }}
    >{label}</button>
  )
}

function TagRow({ name, net, voted, onVoteUp, onVoteDown, isCommunity = false }) {
  const color = getTagColor(name)
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 10px',
      background: '#0f0f1e', borderRadius: 9,
      border: isCommunity ? `1.5px dashed ${color}44` : `1px solid ${color}1a`,
    }}>
      <span style={{
        flex: 1, fontSize: 12, fontWeight: 600,
        color: color + 'cc',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {name}
      </span>
      {isCommunity && (
        <span style={{
          fontSize: 9, color: '#363660', letterSpacing: '0.07em',
          background: 'rgba(99,102,241,0.10)', border: '1px solid rgba(99,102,241,0.20)',
          borderRadius: 4, padding: '1px 6px', flexShrink: 0, fontWeight: 600,
        }}>COMMUNITY</span>
      )}
      <span style={{
        fontSize: 11, minWidth: 32, textAlign: 'right', flexShrink: 0,
        color: net > 0 ? '#22c55e99' : net < 0 ? '#ef444499' : '#40406a',
        fontWeight: 700,
      }}>
        {net > 0 ? '+' : ''}{net}
      </span>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <VoteButton direction="up"   active={voted === 'up'}   disabled={!!voted} onClick={onVoteUp} />
        <VoteButton direction="down" active={voted === 'down'} disabled={!!voted} onClick={onVoteDown} />
      </div>
    </div>
  )
}

export default function CommunityTagSection({ mangaId, defaultTags = [], primaryColor }) {
  const [data, setData]           = useState({ community_tags: [], default_tag_votes: {} })
  const [loading, setLoading]     = useState(false)
  const [newTag, setNewTag]       = useState('')
  const [adding, setAdding]       = useState(false)
  const [error, setError]         = useState(null)
  // votedTags: { "default_TagName" | "community_TagName" : "up" | "down" }
  const [votedTags, setVotedTags] = useState({})

  useEffect(() => {
    if (!mangaId) return
    setLoading(true)
    setVotedTags({})
    setError(null)
    fetch(`/api/manga/${encodeURIComponent(mangaId)}/community-tags`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [mangaId])

  function voteDefault(tagName, delta) {
    const key = `default_${tagName}`
    if (votedTags[key]) return
    setVotedTags(prev => ({ ...prev, [key]: delta > 0 ? 'up' : 'down' }))
    // optimistic update
    setData(prev => {
      const v = prev.default_tag_votes[tagName] || { upvotes: 0, downvotes: 0 }
      return {
        ...prev,
        default_tag_votes: {
          ...prev.default_tag_votes,
          [tagName]: {
            upvotes:   v.upvotes   + (delta > 0 ? 1 : 0),
            downvotes: v.downvotes + (delta < 0 ? 1 : 0),
          },
        },
      }
    })
    fetch(`/api/manga/${encodeURIComponent(mangaId)}/default-tags/${encodeURIComponent(tagName)}/vote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta }),
    }).catch(() => {})
  }

  function voteCommunity(tagName, delta) {
    const key = `community_${tagName}`
    if (votedTags[key]) return
    setVotedTags(prev => ({ ...prev, [key]: delta > 0 ? 'up' : 'down' }))
    setData(prev => ({
      ...prev,
      community_tags: prev.community_tags.map(t =>
        t.tag_name === tagName
          ? { ...t, upvotes: t.upvotes + (delta > 0 ? 1 : 0), downvotes: t.downvotes + (delta < 0 ? 1 : 0) }
          : t
      ),
    }))
    fetch(`/api/manga/${encodeURIComponent(mangaId)}/community-tags/${encodeURIComponent(tagName)}/vote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta }),
    }).catch(() => {})
  }

  async function handleAddTag(e) {
    e.preventDefault()
    const name = newTag.trim()
    if (!name || adding) return
    setAdding(true)
    setError(null)
    try {
      const r = await fetch(`/api/manga/${encodeURIComponent(mangaId)}/community-tags`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag_name: name }),
      })
      const json = await r.json()
      if (!r.ok) { setError(json.detail || 'エラーが発生しました'); setAdding(false); return }
      setData(prev => ({
        ...prev,
        community_tags: [
          ...prev.community_tags.filter(t => t.tag_name !== json.tag_name),
          json,
        ],
      }))
      setNewTag('')
    } catch {
      setError('通信エラーが発生しました')
    }
    setAdding(false)
  }

  const nonSpoilerTags = defaultTags.filter(t => !t.spoiler).slice(0, 15)

  return (
    <div style={{ padding: '18px 22px 22px', borderTop: '1px solid #191928' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 11, color: '#6366f1', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>
          Community Tags
        </span>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
          color: '#6366f1', background: 'rgba(99,102,241,0.14)',
          border: '1px solid rgba(99,102,241,0.30)',
          borderRadius: 5, padding: '2px 7px',
        }}>COMMUNITY MODE</span>
      </div>

      {loading && (
        <div style={{ fontSize: 12, color: '#404070', padding: '8px 0' }}>読み込み中…</div>
      )}

      {/* Default tags with voting */}
      {!loading && nonSpoilerTags.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 10, color: '#404070', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8, fontWeight: 600 }}>
            公式タグを評価する
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {nonSpoilerTags.map(tag => {
              const votes = data.default_tag_votes[tag.name] || { upvotes: 0, downvotes: 0 }
              const net   = votes.upvotes - votes.downvotes
              const voted = votedTags[`default_${tag.name}`]
              return (
                <TagRow
                  key={tag.name}
                  name={tag.name}
                  net={net}
                  voted={voted}
                  onVoteUp={() => voteDefault(tag.name, 1)}
                  onVoteDown={() => voteDefault(tag.name, -1)}
                />
              )
            })}
          </div>
          <div style={{ marginTop: 8, fontSize: 10, color: '#2e2e58', lineHeight: 1.5 }}>
            投票結果はコミュニティモードの類似作品計算に反映されます
          </div>
        </div>
      )}

      {/* Community-added tags */}
      {!loading && data.community_tags.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 10, color: '#404070', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8, fontWeight: 600 }}>
            コミュニティ追加タグ
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {data.community_tags.map(tag => {
              const net   = tag.upvotes - tag.downvotes
              const voted = votedTags[`community_${tag.tag_name}`]
              return (
                <TagRow
                  key={tag.tag_name}
                  name={tag.tag_name}
                  net={net}
                  voted={voted}
                  onVoteUp={() => voteCommunity(tag.tag_name, 1)}
                  onVoteDown={() => voteCommunity(tag.tag_name, -1)}
                  isCommunity
                />
              )
            })}
          </div>
        </div>
      )}

      {/* Add new tag */}
      <div>
        <div style={{ fontSize: 10, color: '#404070', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8, fontWeight: 600 }}>
          タグを追加する
        </div>
        <form onSubmit={handleAddTag} style={{ display: 'flex', gap: 8 }}>
          <input
            value={newTag}
            onChange={e => { setNewTag(e.target.value); setError(null) }}
            placeholder="例: Isekai, Time Travel…"
            maxLength={50}
            style={{
              flex: 1, padding: '8px 12px',
              background: '#0d0d1e',
              border: `1px solid ${error ? '#ef4444' : '#252545'}`,
              borderRadius: 9, color: '#cccce8', fontSize: 13,
              outline: 'none',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => e.target.style.borderColor = '#6366f1'}
            onBlur={e => e.target.style.borderColor = error ? '#ef4444' : '#252545'}
          />
          <button
            type="submit"
            disabled={adding || !newTag.trim()}
            style={{
              background: 'rgba(99,102,241,0.18)',
              border: '1px solid rgba(99,102,241,0.40)',
              borderRadius: 9, color: '#818cf8',
              cursor: adding || !newTag.trim() ? 'default' : 'pointer',
              padding: '8px 16px', fontSize: 13, fontWeight: 600, flexShrink: 0,
              opacity: adding || !newTag.trim() ? 0.45 : 1,
              transition: 'opacity 0.15s',
            }}
          >追加</button>
        </form>
        {error && (
          <div style={{ marginTop: 6, fontSize: 11, color: '#ef4444' }}>{error}</div>
        )}
      </div>
    </div>
  )
}
